import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  TextChannel,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BotClient } from '../../core/client';
import { TicketData, PanelData } from '../../core/db/universalDB';
import { EmbedController } from '../../core/embedController';
import { InteractionHandler } from '../../core/interactionRouter';
import { ErrorHandler } from '../../core/errorHandler';
import { generateProfessionalTranscript, createTranscriptEmbed, generateTicketNumber, TranscriptOptions } from './transcriptGenerator';
import { SetupWizardHandler } from './setupWizard';

export class TicketHandler implements InteractionHandler {
  // Track last channel operation time to avoid rate limits
  private static lastChannelOperation: Map<string, number> = new Map();
  
  /**
   * Map permission names to Discord PermissionFlagsBits
   */
  private mapPermissionsToFlags(permissions: string[]): bigint[] {
    const permissionMap: Record<string, bigint> = {
      'ViewChannel': PermissionFlagsBits.ViewChannel,
      'SendMessages': PermissionFlagsBits.SendMessages,
      'ReadMessageHistory': PermissionFlagsBits.ReadMessageHistory,
      'AttachFiles': PermissionFlagsBits.AttachFiles,
      'EmbedLinks': PermissionFlagsBits.EmbedLinks,
      'AddReactions': PermissionFlagsBits.AddReactions,
      'UseExternalEmojis': PermissionFlagsBits.UseExternalEmojis,
      'MentionEveryone': PermissionFlagsBits.MentionEveryone,
      'ManageMessages': PermissionFlagsBits.ManageMessages,
      'ManageChannels': PermissionFlagsBits.ManageChannels,
      'CreatePublicThreads': PermissionFlagsBits.CreatePublicThreads,
      'CreatePrivateThreads': PermissionFlagsBits.CreatePrivateThreads,
      'SendMessagesInThreads': PermissionFlagsBits.SendMessagesInThreads,
      'UseApplicationCommands': PermissionFlagsBits.UseApplicationCommands,
    };

    return permissions
      .map(perm => permissionMap[perm])
      .filter(flag => flag !== undefined);
  }
  
  /**
   * Safely perform channel operations with rate limit protection
   */
  private async safeChannelOperation<T>(
    channelId: string,
    operation: () => Promise<T>,
    operationName: string,
    minDelay: number = 2000
  ): Promise<{ success: boolean; result: T | null; error?: any }> {
    try {
      // Check if we need to wait
      const lastOp = TicketHandler.lastChannelOperation.get(channelId);
      if (lastOp) {
        const timeSinceLastOp = Date.now() - lastOp;
        if (timeSinceLastOp < minDelay) {
          const waitTime = minDelay - timeSinceLastOp;
          console.log(`[RATE_LIMIT] Waiting ${waitTime}ms before ${operationName}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
      
      // Perform operation with 10 second timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out after 10 seconds')), 10000)
      );
      
      const result = await Promise.race([
        operation(),
        timeoutPromise
      ]);
      
      // Update last operation time
      TicketHandler.lastChannelOperation.set(channelId, Date.now());
      
      return { success: true, result };
    } catch (error: any) {
      console.log(`[${operationName}] Operation failed:`, error);
      
      // Check if it's a rate limit error
      if (error.code === 50013 || error.code === 50035 || error.message?.includes('rate limit') || error.message?.includes('timed out')) {
        console.log(`[${operationName}] RATE LIMIT HIT - Discord allows only 2 channel modifications per 10 minutes`);
        console.log(`[${operationName}] Please wait before making more channel changes`);
      }
      
      return { success: false, result: null, error };
    }
  }

  async execute(interaction: any, client: BotClient, parts: string[]): Promise<void> {
    const action = parts[1];
    const panelOrTicketId = parts.length > 3 ? `${parts[2]}:${parts[3]}` : parts[2];

    try {
      switch (action) {
        case 'open':
          await this.openTicket(interaction, client, panelOrTicketId);
          break;
        case 'answer':
          await this.handleQuestionModal(interaction, client, panelOrTicketId);
          break;
        case 'close':
          await this.closeTicket(interaction, client, panelOrTicketId);
          break;
        case 'reopen':
          await this.reopenTicket(interaction, client, panelOrTicketId);
          break;
        case 'claim':
          await this.claimTicket(interaction, client, panelOrTicketId);
          break;
        case 'unclaim':
          await this.unclaimTicket(interaction, client, panelOrTicketId);
          break;
        case 'transcript':
          await this.generateTranscript(interaction, client, panelOrTicketId);
          break;
        case 'edit-select':
          await this.handleEditSelect(interaction, client);
          break;
        case 'delete-select':
          await this.handleDeleteSelect(interaction, client);
          break;
      }
    } catch (error) {
      ErrorHandler.handle(error as Error, 'TicketHandler');
      await ErrorHandler.sendError(interaction);
    }
  }

  async openTicket(interaction: any, client: BotClient, panelId: string): Promise<void> {
    const panel = await client.db.get<PanelData>(panelId);
    if (!panel) {
      await interaction.reply({
        content: '<:tcet_cross:1437995480754946178> Panel not found. It may have been deleted.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
      return;
    }

    const guild = interaction.guild;
    const user = interaction.user;

    const existingTickets = (await client.db.getAllTickets())
      .filter(t => t.owner === user.id && t.state === 'open' && t.panelId === panelId);

    if (existingTickets.length > 0) {
      const existingChannel = existingTickets[0].channelId;
      await interaction.reply({
        content: `<:tcet_cross:1437995480754946178> You already have an open ticket: <#${existingChannel}>`,
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
      return;
    }

    if (panel.questions && panel.questions.length > 0) {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
      
      type TextInputBuilderType = InstanceType<typeof TextInputBuilder>;
      
      const modal = new ModalBuilder()
        .setCustomId(`ticket:answer:${panelId}`)
        .setTitle('Ticket Information');

      const questionsToShow = panel.questions.slice(0, 5);
      for (let i = 0; i < questionsToShow.length; i++) {
        const textInput = new TextInputBuilder()
          .setCustomId(`question_${i}`)
          .setLabel(questionsToShow[i].substring(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000);

        modal.addComponents(new ActionRowBuilder<TextInputBuilderType>().addComponents(textInput));
      }

      await interaction.showModal(modal);
      return;
    }

    // No questions, so reply with ephemeral message
    await interaction.reply({ content: ' Creating your ticket...', flags: 1 << 6 }); // MessageFlags.Ephemeral
    await this.createTicketChannel(interaction, client, panelId, panel, user, guild, {});
  }

  async handleQuestionModal(interaction: any, client: BotClient, panelId: string): Promise<void> {
    const panel = await client.db.get<PanelData>(panelId);
    if (!panel) return;

    const user = interaction.user;
    const guild = interaction.guild;

    const answers: Record<string, string> = {};
    if (panel.questions) {
      for (let i = 0; i < Math.min(panel.questions.length, 5); i++) {
        answers[panel.questions[i]] = interaction.fields.getTextInputValue(`question_${i}`);
      }
    }

    await interaction.reply({ content: ' Creating your ticket...', flags: 1 << 6 }); // MessageFlags.Ephemeral
    await this.createTicketChannel(interaction, client, panelId, panel, user, guild, answers);
  }

  private async createTicketChannel(
    interaction: any,
    client: BotClient,
    panelId: string,
    panel: PanelData,
    user: any,
    guild: any,
    answers: Record<string, string>
  ): Promise<void> {
    try {
      const ticketId = await client.db.generateTicketId();
      const ticketNumber = ticketId.split(':')[1];

      const channelName = `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
      
      console.log(`[TICKET_CREATE] Creating ticket #${ticketNumber} for user ${user.tag} (${user.id})`);
      console.log(`[TICKET_CREATE] Panel: ${panel.name} (${panelId})`);
      console.log(`[TICKET_CREATE] Channel name: ${channelName}`);
      
      // Build permission overwrites
      const permissionOverwrites: any[] = [
        {
          id: guild.id, // @everyone - DENY ALL PERMISSIONS
          deny: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.UseExternalEmojis,
            PermissionFlagsBits.MentionEveryone,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads,
            PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.UseApplicationCommands,
          ],
        },
        // Bot itself needs full permissions
        {
          id: client.user!.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.AddReactions,
          ],
        },
      ];

      console.log(`[TICKET_CREATE] ✅ Denied all permissions for @everyone`);
      console.log(`[TICKET_CREATE] ✅ Granted full permissions to bot`);

      // Add user permissions
      const userPermissions = panel.userPermissions || [];
      if (userPermissions.length > 0) {
        const userPerms = this.mapPermissionsToFlags(userPermissions);
        permissionOverwrites.push({
          id: user.id,
          allow: userPerms,
        });
        console.log(`[TICKET_CREATE] 👤 User permissions (${userPermissions.length} configured):`);
        userPermissions.forEach(perm => {
          console.log(`[TICKET_CREATE]    ✓ ${perm}`);
        });
      } else {
        // Default user permissions if none specified
        permissionOverwrites.push({
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
        console.log(`[TICKET_CREATE] 👤 User permissions (default - no custom permissions set):`);
        console.log(`[TICKET_CREATE]    ✓ ViewChannel`);
        console.log(`[TICKET_CREATE]    ✓ SendMessages`);
        console.log(`[TICKET_CREATE]    ✓ ReadMessageHistory`);
      }

      // Add staff permissions
      const staffPermissions = panel.staffPermissions || [];
      if (staffPermissions.length > 0) {
        const staffPerms = this.mapPermissionsToFlags(staffPermissions);
        permissionOverwrites.push({
          id: panel.staffRole,
          allow: staffPerms,
        });
        console.log(`[TICKET_CREATE] 👥 Staff role permissions (${staffPermissions.length} configured):`);
        staffPermissions.forEach(perm => {
          console.log(`[TICKET_CREATE]    ✓ ${perm}`);
        });
      } else {
        // Default staff permissions if none specified
        permissionOverwrites.push({
          id: panel.staffRole,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        });
        console.log(`[TICKET_CREATE] 👥 Staff role permissions (default - no custom permissions set):`);
        console.log(`[TICKET_CREATE]    ✓ ViewChannel`);
        console.log(`[TICKET_CREATE]    ✓ SendMessages`);
        console.log(`[TICKET_CREATE]    ✓ ReadMessageHistory`);
        console.log(`[TICKET_CREATE]    ✓ ManageMessages`);
      }
      
      console.log(`[TICKET_CREATE] 🔨 Creating channel in category ${panel.openCategory}...`);
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: panel.openCategory,
        topic: `Ticket #${ticketNumber} | Owner: ${user.tag} | Panel: ${panel.name}`,
        permissionOverwrites,
      });

      console.log(`[TICKET_CREATE] ✅ Channel created successfully: ${channel.name} (${channel.id})`);
      console.log(`[TICKET_CREATE] 📊 Permission Summary:`);
      console.log(`[TICKET_CREATE]    • @everyone: ALL DENIED`);
      console.log(`[TICKET_CREATE]    • Bot: FULL ACCESS`);
      console.log(`[TICKET_CREATE]    • User ${user.tag}: ${userPermissions.length || 3} permissions granted`);
      console.log(`[TICKET_CREATE]    • Staff Role: ${staffPermissions.length || 4} permissions granted`);

      const ticket: TicketData = {
        id: ticketId,
        type: 'ticket',
        owner: user.id,
        panelId: panelId,
        channelId: channel.id,
        state: 'open',
        createdAt: new Date().toISOString(),
      };

      await client.db.save(ticket);

      panel.ticketsCreated = (panel.ticketsCreated || 0) + 1;
      await client.db.save(panel);

      const welcomeEmbed = EmbedController.createTicketWelcomeEmbed(
        user.id,
        panel.staffRole || '',
        panel,
        ticketId
      );

      if (Object.keys(answers).length > 0) {
        for (const [question, answer] of Object.entries(answers)) {
          welcomeEmbed.addFields({
            name: `${question}`,
            value: `\`\`\`${answer}\`\`\``,
            inline: false
          });
        }
      }

      const welcomeMsg = await channel.send({
        content: `<@${user.id}> <@&${panel.staffRole}>`,
        embeds: [welcomeEmbed],
        components: this.createTicketButtons(ticketId, panel),
      });
      
      ticket.welcomeMessageId = welcomeMsg.id;
      await client.db.save(ticket);

      console.log(`[TICKET_CREATE] 💬 Welcome message sent (${welcomeMsg.id})`);
      console.log(`[TICKET_CREATE] 💾 Ticket data saved to database`);
      console.log(`[TICKET_CREATE] 🎫 Ticket #${ticketNumber} creation complete!`);

      if (panel.logsChannel) {
        try {
          const logChannel = await client.channels.fetch(panel.logsChannel);
          if (logChannel?.isTextBased() && 'send' in logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle(' New Ticket Created')
              .setColor(null)
              .addFields(
                { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Panel', value: panel.name || 'Unknown', inline: true }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Log ticket creation');
        }
      }

      await interaction.followUp({
        content: `<:tcet_tick:1437995479567962184> Ticket created: <#${channel.id}>`,
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'Create ticket channel');
      await interaction.followUp({
        content: '<:tcet_cross:1437995480754946178> Failed to create ticket. Please try again.',
      });
    }
  }

  async closeTicket(interaction: any, client: BotClient, ticketId: string): Promise<void> {
    console.log(`[CLOSE] Starting close process for ticket: ${ticketId}`);
    
    const ticket = await client.db.get<TicketData>(ticketId);
    if (!ticket) {
      console.log(`[CLOSE] Ticket not found: ${ticketId}`);
      // Always use followUp with ephemeral for error messages (interaction may be deferred by router)
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    console.log(`[CLOSE] Ticket found - State: ${ticket.state}, Welcome Message ID: ${ticket.welcomeMessageId}`);
    
    // Check if ticket is already closed to prevent duplicate operations
    const currentState = ticket.state as string;
    if (currentState === 'closed') {
      console.log(`[CLOSE] Ticket is already closed, aborting duplicate request`);
      // Always use followUp with ephemeral for error messages (interaction may be deferred by router)
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> This ticket is already closed.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> This ticket is already closed.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    const panel = await client.db.get<PanelData>(ticket.panelId);
    if (!panel) {
      console.log(`[CLOSE] Panel not found: ${ticket.panelId}`);
      // Always use followUp with ephemeral for error messages (interaction may be deferred by router)
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Check if user is the owner
    const isOwner = ticket.owner === interaction.user.id;
    const member = interaction.member as any;
    const isStaff = member?.roles?.cache?.has(panel.staffRole || '') || interaction.memberPermissions?.has('ManageChannels');
    
    // Check permission based on allowOwnerClose setting
    if (isOwner && panel.allowOwnerClose === false && !isStaff) {
      console.log(`[CLOSE] Owner attempted to close but allowOwnerClose is false`);
      // Always use followUp with ephemeral for error messages (interaction may be deferred by router)
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> **Only staff members can close this ticket.**\n\nIf you need assistance, please wait for a staff member.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> **Only staff members can close this ticket.**\n\nIf you need assistance, please wait for a staff member.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Defer update if not already deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    try {
      const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.log(`[CLOSE] Channel not found or invalid type: ${ticket.channelId}`);
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket channel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
        return;
      }

      console.log(`[CLOSE] Channel found: ${channel.name}`);

      // NOTE: We do NOT delete messages anymore to preserve full transcript
      // All messages will be kept for the transcript generation

      let newName: string;
      if (channel.name.startsWith('claimed-')) {
        newName = channel.name.replace('claimed-', 'closed-claimed-');
      } else if (channel.name.startsWith('ticket-')) {
        newName = channel.name.replace('ticket-', 'closed-ticket-');
      } else {
        newName = `closed-${channel.name}`;
      }
      console.log(`[CLOSE] Renaming channel from "${channel.name}" to "${newName}"`);
      console.log(`[CLOSE] Channel details:`, JSON.stringify({ 
        id: channel.id, 
        name: channel.name, 
        type: channel.type,
        parentId: channel.parentId 
      }));
      
      // Use safe channel operations with rate limit protection
      const renameResult = await this.safeChannelOperation(
        channel.id,
        () => channel.setName(newName),
        'CLOSE_RENAME'
      );
      
      if (renameResult.success) {
        console.log(`[CLOSE] Channel renamed successfully to "${newName}"`);
      } else {
        console.log(`[CLOSE] Channel rename failed, continuing anyway...`);
        console.log(`[CLOSE] Rename error:`, renameResult.error);
      }
      
      let moveSuccess = true;
      if (panel.closeCategory) {
        console.log(`[CLOSE] Moving to close category: ${panel.closeCategory}`);
        const moveResult = await this.safeChannelOperation(
          channel.id,
          () => channel.setParent(panel.closeCategory!),
          'CLOSE_MOVE',
          2000 // Wait at least 2 seconds after rename
        );
        
        if (moveResult.success) {
          console.log(`[CLOSE] Channel moved to close category successfully`);
        } else {
          console.log(`[CLOSE] Channel move failed, continuing anyway...`);
          console.log(`[CLOSE] Move error:`, moveResult.error);
          moveSuccess = false;
        }
      }

      // Remove user permissions (hide from user) but keep everything else
      console.log(`[CLOSE] Removing user permissions from channel...`);
      try {
        await channel.permissionOverwrites.delete(ticket.owner);
        console.log(`[CLOSE] User permissions removed successfully`);
      } catch (error) {
        console.log(`[CLOSE] Failed to remove user permissions:`, error);
      }

      ticket.state = 'closed';
      ticket.closedAt = new Date().toISOString();
      await client.db.save(ticket);
      console.log(`[CLOSE] Ticket state saved as closed`);

      // Update welcome message to show closed state
      console.log(`[CLOSE] Updating welcome message...`);
      await this.updateWelcomeMessageForClosed(channel, ticket, interaction.user.id);
      console.log(`[CLOSE] Welcome message updated`);

      // Provide feedback with warnings if operations failed
      let responseMessage = '<:tcet_tick:1437995479567962184> Ticket closed successfully.';
      if (!renameResult.success || !moveSuccess) {
        responseMessage += '\n⚠️ Note: Some channel operations were rate-limited by Discord. The ticket is closed, but the channel may not have been renamed or moved yet.';
      }

      await interaction.followUp({
        content: responseMessage,
        flags: 1 << 6 // MessageFlags.Ephemeral
      });

      console.log(`[CLOSE] Logging to logs channel...`);
      if (panel.logsChannel) {
        try {
          const logChannel = await client.channels.fetch(panel.logsChannel);
          if (logChannel?.isTextBased() && 'send' in logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle('<:tcet_cross:1437995480754946178> Ticket Closed')
              .setColor(null)
              .addFields(
                { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
                { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Owner', value: `<@${ticket.owner}>`, inline: true }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Log ticket closure');
        }
      }

      console.log(`[CLOSE] Starting transcript generation...`);
      setImmediate(async () => {
        try {
          if (channel instanceof TextChannel) {
            await this.autoGenerateTranscript(channel, ticket, panel, client);
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Auto-generate transcript');
        }
      });
      
      console.log(`[CLOSE] Close process complete for ticket: ${ticketId}`);
    } catch (error) {
      console.log(`[CLOSE] Error during close:`, error);
      ErrorHandler.handle(error as Error, 'Close ticket');
      await interaction.followUp({
        content: '<:tcet_cross:1437995480754946178> Failed to close ticket. Please try again.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }
  }

  async reopenTicket(interaction: any, client: BotClient, ticketId: string): Promise<void> {
    console.log(`[REOPEN] Starting reopen process for ticket: ${ticketId}`);
    
    const ticket = await client.db.get<TicketData>(ticketId);
    if (!ticket) {
      console.log(`[REOPEN] Ticket not found: ${ticketId}`);
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    console.log(`[REOPEN] Ticket found - State: ${ticket.state}, Welcome Message ID: ${ticket.welcomeMessageId}`);

    // Check if ticket is already open
    if (ticket.state === 'open') {
      console.log(`[REOPEN] Ticket is already open, aborting`);
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> This ticket is already open.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> This ticket is already open.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    const panel = await client.db.get<PanelData>(ticket.panelId);
    if (!panel) {
      console.log(`[REOPEN] Panel not found: ${ticket.panelId}`);
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Defer update if not already deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    try {
      const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.log(`[REOPEN] Channel not found or invalid type: ${ticket.channelId}`);
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket channel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
        return;
      }

      console.log(`[REOPEN] Channel found: ${channel.name}`);

      let newName: string;
      if (channel.name.startsWith('closed-claimed-')) {
        newName = channel.name.replace('closed-claimed-', 'claimed-');
      } else if (channel.name.startsWith('closed-ticket-')) {
        newName = channel.name.replace('closed-ticket-', 'ticket-');
      } else if (channel.name.startsWith('closed-')) {
        newName = channel.name.replace('closed-', '');
      } else {
        newName = channel.name.startsWith('ticket-') ? channel.name : `ticket-${channel.name}`;
      }
      console.log(`[REOPEN] Renaming channel from "${channel.name}" to "${newName}"`);
      console.log(`[REOPEN] Channel details:`, JSON.stringify({ 
        id: channel.id, 
        name: channel.name, 
        type: channel.type,
        parentId: channel.parentId 
      }));
      
      // Use safe channel operations with rate limit protection
      const renameResult = await this.safeChannelOperation(
        channel.id,
        () => channel.setName(newName),
        'REOPEN_RENAME'
      );
      
      if (renameResult.success) {
        console.log(`[REOPEN] Channel renamed successfully to "${newName}"`);
      } else {
        console.log(`[REOPEN] Channel rename failed, continuing anyway...`);
        console.log(`[REOPEN] Rename error:`, renameResult.error);
      }
      
      let moveSuccess = true;
      if (panel.openCategory) {
        console.log(`[REOPEN] Moving to open category: ${panel.openCategory}`);
        const moveResult = await this.safeChannelOperation(
          channel.id,
          () => channel.setParent(panel.openCategory!),
          'REOPEN_MOVE',
          2000 // Wait at least 2 seconds after rename
        );
        
        if (moveResult.success) {
          console.log(`[REOPEN] Channel moved to open category successfully`);
        } else {
          console.log(`[REOPEN] Channel move failed, continuing anyway...`);
          console.log(`[REOPEN] Move error:`, moveResult.error);
          moveSuccess = false;
        }
      }

      // Restore user permissions
      console.log(`[REOPEN] Restoring user permissions to channel...`);
      try {
        const userPermissions = panel.userPermissions || [];
        if (userPermissions.length > 0) {
          const userPerms = this.mapPermissionsToFlags(userPermissions);
          await channel.permissionOverwrites.create(ticket.owner, {
            ViewChannel: true,
            SendMessages: userPerms.includes(PermissionFlagsBits.SendMessages) ? true : null,
            ReadMessageHistory: userPerms.includes(PermissionFlagsBits.ReadMessageHistory) ? true : null,
            AttachFiles: userPerms.includes(PermissionFlagsBits.AttachFiles) ? true : null,
            EmbedLinks: userPerms.includes(PermissionFlagsBits.EmbedLinks) ? true : null,
            AddReactions: userPerms.includes(PermissionFlagsBits.AddReactions) ? true : null,
            UseExternalEmojis: userPerms.includes(PermissionFlagsBits.UseExternalEmojis) ? true : null,
            MentionEveryone: userPerms.includes(PermissionFlagsBits.MentionEveryone) ? true : null,
            ManageMessages: userPerms.includes(PermissionFlagsBits.ManageMessages) ? true : null,
            ManageChannels: userPerms.includes(PermissionFlagsBits.ManageChannels) ? true : null,
            CreatePublicThreads: userPerms.includes(PermissionFlagsBits.CreatePublicThreads) ? true : null,
            CreatePrivateThreads: userPerms.includes(PermissionFlagsBits.CreatePrivateThreads) ? true : null,
            SendMessagesInThreads: userPerms.includes(PermissionFlagsBits.SendMessagesInThreads) ? true : null,
            UseApplicationCommands: userPerms.includes(PermissionFlagsBits.UseApplicationCommands) ? true : null,
          });
          console.log(`[REOPEN] User permissions restored (${userPermissions.length} permissions)`);
        } else {
          // Default permissions if none configured
          await channel.permissionOverwrites.create(ticket.owner, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
          console.log(`[REOPEN] User permissions restored (default permissions)`);
        }
      } catch (error) {
        console.log(`[REOPEN] Failed to restore user permissions:`, error);
      }

      ticket.state = 'open';
      ticket.closedAt = undefined;
      ticket.closeMessageId = undefined;
      await client.db.save(ticket);
      console.log(`[REOPEN] Ticket state saved as open, welcome message ID preserved: ${ticket.welcomeMessageId}`);

      // Update welcome message with open buttons
      console.log(`[REOPEN] Updating welcome message buttons...`);
      await this.updateWelcomeMessageButtons(channel, ticket, panel);
      console.log(`[REOPEN] Welcome message buttons updated`);

      // Provide feedback with warnings if operations failed
      let responseMessage = '<:tcet_tick:1437995479567962184> Ticket reopened successfully.';
      if (!renameResult.success || !moveSuccess) {
        responseMessage += '\n⚠️ Note: Some channel operations were rate-limited by Discord. The ticket is open, but the channel may not have been renamed or moved yet.';
      }

      await interaction.followUp({
        content: responseMessage,
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
      
      console.log(`[REOPEN] Reopen process complete for ticket: ${ticketId}`);
    } catch (error) {
      console.log(`[REOPEN] Error during reopen:`, error);
      ErrorHandler.handle(error as Error, 'Reopen ticket');
      await interaction.followUp({
        content: '<:tcet_cross:1437995480754946178> Failed to reopen ticket. Please try again.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }
  }

  async claimTicket(interaction: any, client: BotClient, ticketId: string): Promise<void> {
    const ticket = await client.db.get<TicketData>(ticketId);
    if (!ticket) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    if (ticket.claimedBy) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: `<:tcet_cross:1437995480754946178> This ticket has already been claimed by <@${ticket.claimedBy}>`,
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: `<:tcet_cross:1437995480754946178> This ticket has already been claimed by <@${ticket.claimedBy}>`,
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    const panel = await client.db.get<PanelData>(ticket.panelId);
    if (!panel) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Check if user is staff
    const member = interaction.member as any;
    const isStaff = member?.roles?.cache?.has(panel.staffRole || '') || interaction.memberPermissions?.has('ManageChannels');
    
    if (!isStaff) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> **Only staff members can claim tickets.**\n\nYou must have the staff role to claim this ticket.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> **Only staff members can claim tickets.**\n\nYou must have the staff role to claim this ticket.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Defer update if not already deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    ticket.claimedBy = interaction.user.id;
    await client.db.save(ticket);

    try {
      const channel = await client.channels.fetch(ticket.channelId);
      if (channel?.isTextBased() && 'send' in channel) {
        if ('setName' in channel) {
          const newName = `claimed-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          try {
            await channel.setName(newName);
            console.log(`[CLAIM] Channel renamed to: ${newName}`);
          } catch (error) {
            console.log(`[CLAIM] Failed to rename channel:`, error);
          }
        }

        const claimEmbed = new EmbedBuilder()
          .setTitle('<:tcet_tick:1437995479567962184> Ticket Claimed')
          .setDescription(`This ticket has been claimed by <@${interaction.user.id}>`)
          .setColor(null)
          .setTimestamp();

        await channel.send({ embeds: [claimEmbed] });
      }

      await interaction.followUp({
        content: '<:tcet_tick:1437995479567962184> You have claimed this ticket.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'Claim ticket');
      await interaction.followUp({
        content: '<:tcet_cross:1437995480754946178> Failed to claim ticket. Please try again.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }
  }

  async unclaimTicket(interaction: any, client: BotClient, ticketId: string): Promise<void> {
    const ticket = await client.db.get<TicketData>(ticketId);
    if (!ticket) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    if (!ticket.claimedBy) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> This ticket is not claimed.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> This ticket is not claimed.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    if (ticket.claimedBy !== interaction.user.id && !interaction.memberPermissions?.has('ManageChannels')) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> You can only unclaim tickets that you claimed.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> You can only unclaim tickets that you claimed.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Defer update if not already deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    const claimedByUser = ticket.claimedBy;

    ticket.claimedBy = undefined;
    await client.db.save(ticket);

    try {
      const channel = await client.channels.fetch(ticket.channelId);
      const owner = await client.users.fetch(ticket.owner);
      
      if (channel?.isTextBased() && 'send' in channel) {
        if ('setName' in channel) {
          const newName = `ticket-${owner.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          try {
            await channel.setName(newName);
            console.log(`[UNCLAIM] Channel renamed to: ${newName}`);
          } catch (error) {
            console.log(`[UNCLAIM] Failed to rename channel:`, error);
          }
        }

        const unclaimEmbed = new EmbedBuilder()
          .setTitle('<:tcet_tick:1437995479567962184> Ticket Unclaimed')
          .setDescription(`This ticket has been unclaimed by <@${claimedByUser}>`)
          .setColor(null)
          .setTimestamp();

        await channel.send({ embeds: [unclaimEmbed] });
      }

      await interaction.followUp({
        content: '<:tcet_tick:1437995479567962184> You have unclaimed this ticket.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'Unclaim ticket');
      await interaction.followUp({
        content: '<:tcet_cross:1437995480754946178> Failed to unclaim ticket. Please try again.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }
  }

  async generateTranscript(interaction: any, client: BotClient, ticketId: string): Promise<void> {
    const ticket = await client.db.get<TicketData>(ticketId);
    if (!ticket) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Ticket not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    const panel = await client.db.get<PanelData>(ticket.panelId);
    if (!panel) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    // Send initial response
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: '⏳ Generating transcript... This may take a moment.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    } else {
      await interaction.reply({
        content: '⏳ Generating transcript... This may take a moment.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }

    try {
      const channel = await client.channels.fetch(ticket.channelId);
      if (!channel || !channel.isTextBased()) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Ticket channel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
        return;
      }

      if (!(channel instanceof TextChannel)) {
        throw new Error('Channel is not a text channel');
      }

      // Generate professional transcript using discord-html-transcripts
      const ticketNumber = parseInt(ticket.id.split(':')[1]);
      const owner = await client.users.fetch(ticket.owner);
      
      let staffName: string | undefined;
      let staffId: string | undefined;
      if (ticket.claimedBy) {
        try {
          const staff = await client.users.fetch(ticket.claimedBy);
          staffName = staff.username;
          staffId = staff.id;
        } catch (error) {
          console.warn('Could not fetch staff user');
        }
      }

      const transcriptOptions: TranscriptOptions = {
        ticketId: ticket.id,
        ticketNumber,
        username: owner.username,
        userId: owner.id,
        staffName,
        staffId,
        panelName: panel.name || 'Unknown Panel',
        createdAt: new Date(ticket.createdAt),
        closedAt: ticket.closedAt ? new Date(ticket.closedAt) : undefined
      };

      const attachment = await generateProfessionalTranscript(channel, transcriptOptions);
      const transcriptEmbed = createTranscriptEmbed(transcriptOptions);

      if (panel.transcriptChannel) {
        try {
          const transcriptChannel = await client.channels.fetch(panel.transcriptChannel);
          if (transcriptChannel?.isTextBased() && 'send' in transcriptChannel) {
            await transcriptChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Send transcript to channel');
        }
      }

      if (panel.logsChannel) {
        try {
          const logChannel = await client.channels.fetch(panel.logsChannel);
          if (logChannel?.isTextBased() && 'send' in logChannel) {
            await logChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Send transcript to logs');
        }
      }

      try {
        const owner = await client.users.fetch(ticket.owner);
        await owner.send({
          content: `<:module:1437997093753983038> Here is the transcript of your ticket from **${interaction.guild?.name}**:`,
          files: [attachment],
        });
      } catch (error) {
        ErrorHandler.warn('Could not DM transcript to ticket owner');
      }

      await interaction.followUp({
        content: '<:tcet_tick:1437995479567962184> Transcript generated and saved successfully!',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    } catch (error) {
      ErrorHandler.handle(error as Error, 'Generate transcript');
      await interaction.followUp({
        content: '<:tcet_cross:1437995480754946178> Failed to generate transcript. Please try again.',
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }
  }

  async handleEditSelect(interaction: StringSelectMenuInteraction, client: BotClient): Promise<void> {
    const panelId = interaction.values[0];
    const userId = interaction.user.id;

    const wizardHandler = new SetupWizardHandler();
    await wizardHandler.handleEditSelect(interaction, client, userId);
  }

  async handleDeleteSelect(interaction: StringSelectMenuInteraction, client: BotClient): Promise<void> {
    const panelId = interaction.values[0];
    const panel = await client.db.get<PanelData>(panelId);

    if (!panel) {
      // Use editReply if already deferred (by router), otherwise reply
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '<:tcet_cross:1437995480754946178> Panel not found.',
          flags: 1 << 6 // MessageFlags.Ephemeral
        });
      }
      return;
    }

    if (panel.messageId && panel.channel) {
      try {
        const channel = await client.channels.fetch(panel.channel);
        if (channel?.isTextBased() && 'messages' in channel) {
          const message = await channel.messages.fetch(panel.messageId);
          await message.delete();
        }
      } catch (error) {
        ErrorHandler.warn('Could not delete panel message');
      }
    }

    await client.db.delete(panelId);

    // Use editReply if already deferred (by router), otherwise reply
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: `<:tcet_tick:1437995479567962184> **Panel "${panel.name}" deleted successfully!**`,
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    } else {
      await interaction.reply({
        content: `<:tcet_tick:1437995479567962184> **Panel "${panel.name}" deleted successfully!**`,
        flags: 1 << 6 // MessageFlags.Ephemeral
      });
    }
  }

  private async autoGenerateTranscript(
    channel: TextChannel,
    ticket: TicketData,
    panel: PanelData,
    client: BotClient
  ): Promise<void> {
    try {
      // Generate professional transcript using discord-html-transcripts
      const ticketNumber = parseInt(ticket.id.split(':')[1]);
      const owner = await client.users.fetch(ticket.owner);
      
      let staffName: string | undefined;
      let staffId: string | undefined;
      if (ticket.claimedBy) {
        try {
          const staff = await client.users.fetch(ticket.claimedBy);
          staffName = staff.username;
          staffId = staff.id;
        } catch (error) {
          console.warn('Could not fetch staff user');
        }
      }

      const transcriptOptions: TranscriptOptions = {
        ticketId: ticket.id,
        ticketNumber,
        username: owner.username,
        userId: owner.id,
        staffName,
        staffId,
        panelName: panel.name || 'Unknown Panel',
        createdAt: new Date(ticket.createdAt),
        closedAt: ticket.closedAt ? new Date(ticket.closedAt) : undefined
      };

      const attachment = await generateProfessionalTranscript(channel, transcriptOptions);
      const transcriptEmbed = createTranscriptEmbed(transcriptOptions);

      if (panel.transcriptChannel) {
        try {
          const transcriptChannel = await client.channels.fetch(panel.transcriptChannel);
          if (transcriptChannel?.isTextBased() && 'send' in transcriptChannel) {
            await transcriptChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Send transcript to channel');
        }
      }

      if (panel.logsChannel) {
        try {
          const logChannel = await client.channels.fetch(panel.logsChannel);
          if (logChannel?.isTextBased() && 'send' in logChannel) {
            await logChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
          }
        } catch (error) {
          ErrorHandler.handle(error as Error, 'Send transcript to logs');
        }
      }

      try {
        const owner = await client.users.fetch(ticket.owner);
        await owner.send({
          content: `📋 Your ticket has been closed. Here is the transcript:`,
          embeds: [transcriptEmbed],
          files: [attachment],
        });
      } catch (error) {
        ErrorHandler.warn('Could not DM transcript to ticket owner');
      }
    } catch (error) {
      ErrorHandler.handle(error as Error, 'Auto-generate transcript');
    }
  }

  private createTicketButtons(ticketId: string, panel: PanelData): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${ticketId}`)
        .setLabel('Close')
        .setEmoji('<:tcet_cross:1437995480754946178>')
        .setStyle(ButtonStyle.Danger)
    );

    if (panel.claimable) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:claim:${ticketId}`)
          .setLabel('Claim')
          .setEmoji('<:tcet_tick:1437995479567962184>')
          .setStyle(ButtonStyle.Primary)
      );
    }

    return [row];
  }

  private createClosedTicketButtons(ticketId: string): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:reopen:${ticketId}`)
        .setLabel('Reopen')
        .setEmoji('<:tcet_tick:1437995479567962184>')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ticket:transcript:${ticketId}`)
        .setLabel('Transcript')
        .setEmoji('<:module:1437997093753983038>')
        .setStyle(ButtonStyle.Primary)
    );

    return [row];
  }

  private async cleanupTicketMessages(channel: any, ticket: TicketData): Promise<void> {
    try {
      console.log(`[CLEANUP] Starting message cleanup for ticket ${ticket.id}`);
      console.log(`[CLEANUP] Welcome message ID to preserve: ${ticket.welcomeMessageId}`);
      
      // Fetch all messages in the channel
      const messages = await channel.messages.fetch({ limit: 100 });
      console.log(`[CLEANUP] Fetched ${messages.size} messages from channel`);
      
      // Filter messages to delete (all except the welcome message)
      const messagesToDelete = messages.filter((msg: any) => {
        // Keep the welcome message
        if (ticket.welcomeMessageId && msg.id === ticket.welcomeMessageId) {
          console.log(`[CLEANUP] Preserving welcome message: ${msg.id}`);
          return false;
        }
        // Keep messages older than 14 days (can't bulk delete those)
        const messageAge = Date.now() - msg.createdTimestamp;
        if (messageAge > 14 * 24 * 60 * 60 * 1000) {
          console.log(`[CLEANUP] Skipping old message (>14 days): ${msg.id}`);
          return false;
        }
        return true;
      });

      console.log(`[CLEANUP] Messages to delete: ${messagesToDelete.size}`);
      
      // Bulk delete messages (max 100 at a time)
      if (messagesToDelete.size > 0) {
        await channel.bulkDelete(messagesToDelete, true).catch(() => {
          console.log(`[CLEANUP] Bulk delete failed, trying individual deletion`);
          // If bulk delete fails, try individual deletion
          messagesToDelete.forEach(async (msg: any) => {
            await msg.delete().catch(() => {});
          });
        });
        console.log(`[CLEANUP] Deleted ${messagesToDelete.size} messages`);
      }
      
      console.log(`[CLEANUP] Cleanup complete`);
    } catch (error) {
      console.log(`[CLEANUP] Error during cleanup:`, error);
      // Silently handle cleanup errors
      ErrorHandler.warn('Could not cleanup ticket messages');
    }
  }

  private async updateWelcomeMessageButtons(channel: any, ticket: TicketData, panel: PanelData): Promise<void> {
    try {
      console.log(`[UPDATE_BUTTONS] Attempting to update buttons for ticket ${ticket.id}`);
      console.log(`[UPDATE_BUTTONS] Welcome message ID: ${ticket.welcomeMessageId}`);
      
      if (!ticket.welcomeMessageId) {
        console.log(`[UPDATE_BUTTONS] No welcome message ID found, skipping update`);
        return;
      }
      
      const welcomeMsg = await channel.messages.fetch(ticket.welcomeMessageId).catch((err: any) => {
        console.log(`[UPDATE_BUTTONS] Failed to fetch welcome message:`, err.message);
        return null;
      });
      
      if (!welcomeMsg) {
        console.log(`[UPDATE_BUTTONS] Welcome message not found in channel`);
        return;
      }

      console.log(`[UPDATE_BUTTONS] Welcome message found, updating to open buttons`);
      // Update with open ticket buttons
      const buttons = this.createTicketButtons(ticket.id, panel);
      await welcomeMsg.edit({ components: buttons }).catch((err: any) => {
        console.log(`[UPDATE_BUTTONS] Failed to edit message:`, err.message);
      });
      console.log(`[UPDATE_BUTTONS] Buttons updated successfully`);
    } catch (error) {
      console.log(`[UPDATE_BUTTONS] Error updating welcome message buttons:`, error);
      ErrorHandler.warn('Could not update welcome message buttons');
    }
  }

  private async updateWelcomeMessageForClosed(channel: any, ticket: TicketData, closedByUserId: string): Promise<void> {
    try {
      console.log(`[UPDATE_CLOSED] Attempting to update for closed state, ticket ${ticket.id}`);
      console.log(`[UPDATE_CLOSED] Welcome message ID: ${ticket.welcomeMessageId}`);
      
      if (!ticket.welcomeMessageId) {
        console.log(`[UPDATE_CLOSED] No welcome message ID found, skipping update`);
        return;
      }
      
      const welcomeMsg = await channel.messages.fetch(ticket.welcomeMessageId).catch((err: any) => {
        console.log(`[UPDATE_CLOSED] Failed to fetch welcome message:`, err.message);
        return null;
      });
      
      if (!welcomeMsg) {
        console.log(`[UPDATE_CLOSED] Welcome message not found in channel`);
        return;
      }

      console.log(`[UPDATE_CLOSED] Welcome message found, updating to closed buttons`);
      // Update welcome message with closed buttons
      const closedButtons = this.createClosedTicketButtons(ticket.id);
      
      // Get the existing embeds and update them
      const existingEmbeds = welcomeMsg.embeds;
      console.log(`[UPDATE_CLOSED] Found ${existingEmbeds.length} embeds`);
      
      if (existingEmbeds.length > 0) {
        const embed = EmbedBuilder.from(existingEmbeds[0]);
        embed.setFooter({ text: `Closed by user ${closedByUserId} • Powered by Beru Tickets` });
        
        await welcomeMsg.edit({ 
          embeds: [embed],
          components: closedButtons 
        }).catch((err: any) => {
          console.log(`[UPDATE_CLOSED] Failed to edit message with embed:`, err.message);
        });
      } else {
        await welcomeMsg.edit({ components: closedButtons }).catch((err: any) => {
          console.log(`[UPDATE_CLOSED] Failed to edit message without embed:`, err.message);
        });
      }
      console.log(`[UPDATE_CLOSED] Message updated successfully`);
    } catch (error) {
      console.log(`[UPDATE_CLOSED] Error updating welcome message for closed state:`, error);
      ErrorHandler.warn('Could not update welcome message for closed state');
    }
  }
}
