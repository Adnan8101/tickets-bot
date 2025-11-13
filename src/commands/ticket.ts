import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { BotClient } from '../core/client';
import { EmbedController } from '../core/embedController';
import { SetupWizardHandler } from '../modules/ticket/setupWizard';
import { PanelData } from '../core/db/universalDB';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage ticket panels')
  .addSubcommandGroup(group =>
    group
      .setName('panel')
      .setDescription('Panel management')
      .addSubcommand(sub =>
        sub.setName('setup').setDescription('Create a new ticket panel')
      )
      .addSubcommand(sub =>
        sub.setName('edit').setDescription('Edit an existing ticket panel')
      )
      .addSubcommand(sub =>
        sub.setName('delete').setDescription('Delete a ticket panel')
      )
      .addSubcommand(sub =>
        sub.setName('list').setDescription('List all configured panels')
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('close')
      .setDescription('Close the current ticket')
  )
  .addSubcommand(sub =>
    sub
      .setName('reopen')
      .setDescription('Reopen the current ticket')
  )
  .addSubcommand(sub =>
    sub
      .setName('rename')
      .setDescription('Rename the current ticket channel')
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('New channel name')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription('Add a user to the current ticket')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User to add to the ticket')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('claim')
      .setDescription('Claim the current ticket')
  )
  .addSubcommand(sub =>
    sub
      .setName('unclaim')
      .setDescription('Unclaim the current ticket')
  )
  .addSubcommand(sub =>
    sub
      .setName('clear-ticket')
      .setDescription('Clear a user\'s ticket data so they can create a new ticket')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('The user whose ticket to clear')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('panel')
          .setDescription('The panel ID (optional, clears all panels if not specified)')
          .setRequired(false)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'panel') {
    switch (subcommand) {
      case 'setup':
        await handleSetup(interaction, client);
        break;
      case 'edit':
        await handleEdit(interaction, client);
        break;
      case 'delete':
        await handleDelete(interaction, client);
        break;
      case 'list':
        await handleList(interaction, client);
        break;
    }
  } else {
    switch (subcommand) {
      case 'close':
        await handleClose(interaction, client);
        break;
      case 'reopen':
        await handleReopen(interaction, client);
        break;
      case 'rename':
        await handleRename(interaction, client);
        break;
      case 'add':
        await handleAddUser(interaction, client);
        break;
      case 'claim':
        await handleClaim(interaction, client);
        break;
      case 'unclaim':
        await handleUnclaim(interaction, client);
        break;
      case 'clear-ticket':
        await handleClearTicket(interaction, client);
        break;
    }
  }
}

async function handleSetup(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const wizardHandler = new SetupWizardHandler();
  await wizardHandler.showMainMenu(interaction, client, interaction.user.id);
}

async function handleEdit(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const panels = await client.db.getAllPanels();
  
  if (panels.length === 0) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> No panels configured. Use `/ticket panel setup` to create one!',
    });
    return;
  }

  const options = panels.map((panel: PanelData) => ({
    label: panel.name || 'Unnamed Panel',
    description: panel.channel ? `Channel: #${panel.channel}` : 'No channel set',
    value: panel.id,
    emoji: panel.emoji || '<:module:1437997093753983038>',
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket:edit-select')
    .setPlaceholder('Select a panel to edit')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    content: '<:module:1437997093753983038> Select a panel to edit:',
    components: [row],
  });
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const panels = await client.db.getAllPanels();
  
  if (panels.length === 0) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> No panels configured.',
    });
    return;
  }

  const options = panels.map((panel: PanelData) => ({
    label: panel.name || 'Unnamed Panel',
    description: panel.channel ? `Channel: #${panel.channel}` : 'No channel set',
    value: panel.id,
    emoji: panel.emoji || '<:module:1437997093753983038>',
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket:delete-select')
    .setPlaceholder('Select a panel to delete')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    content: '🗑️ Select a panel to delete:',
    components: [row],
  });
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const panels = await client.db.getAllPanels();
  const embed = EmbedController.createPanelListEmbed(panels);

  await interaction.editReply({ embeds: [embed] });
}

async function handleClearTicket(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const user = interaction.options.getUser('user', true);
  const panelId = interaction.options.getString('panel');

  // Get all tickets for this user
  const allTickets = await client.db.getAllTickets();
  let ticketsToClear = allTickets.filter((t: any) => t.owner === user.id);

  // If panel ID specified, only clear tickets for that panel
  if (panelId) {
    ticketsToClear = ticketsToClear.filter((t: any) => t.panelId === panelId);
    
    if (ticketsToClear.length === 0) {
      await interaction.editReply({
        content: `<:tcet_cross:1437995480754946178> No tickets found for ${user.tag} on panel \`${panelId}\`.`,
      });
      return;
    }
  } else {
    if (ticketsToClear.length === 0) {
      await interaction.editReply({
        content: `<:tcet_cross:1437995480754946178> No tickets found for ${user.tag}.`,
      });
      return;
    }
  }

  // Delete ticket channels and data
  let deletedChannels = 0;
  let deletedData = 0;

  for (const ticket of ticketsToClear) {
    // Try to delete the channel
    try {
      const channel = await client.channels.fetch(ticket.channelId);
      if (channel) {
        await channel.delete();
        deletedChannels++;
      }
    } catch (error) {
      console.warn(`Could not delete channel ${ticket.channelId}:`, error);
    }

    // Delete ticket data from database
    client.db.delete(ticket.id);
    deletedData++;
  }

  const panelText = panelId ? ` on panel \`${panelId}\`` : ' from all panels';
  await interaction.editReply({
    content: `<:tcet_tick:1437995479567962184> **Cleared ${deletedData} ticket(s) for ${user.tag}${panelText}**\n\n` +
             `<:k9logging:1437996243803705354> Channels deleted: ${deletedChannels}\n` +
             `🗑️ Database entries removed: ${deletedData}\n\n` +
             `${user.tag} can now create new tickets!`,
  });
}

async function handleClose(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This command can only be used in a ticket channel.',
    });
    return;
  }

  // Find ticket by channel ID
  const tickets = await client.db.getAllTickets();
  const ticket = tickets.find((t: any) => t.channelId === channel.id);

  if (!ticket) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This is not a ticket channel.',
    });
    return;
  }

  if (ticket.state === 'closed') {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This ticket is already closed.',
    });
    return;
  }

  // Get panel to check allowOwnerClose
  const panel = await client.db.get(ticket.panelId) as PanelData | null;
  
  // Check if user is the owner
  const isOwner = ticket.owner === interaction.user.id;
  const isStaff = interaction.memberPermissions?.has('ManageChannels');
  
  // Check permission based on allowOwnerClose setting
  if (isOwner && panel?.allowOwnerClose === false && !isStaff) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> **Only staff members can close this ticket.**\n\nIf you need assistance, please wait for a staff member.',
    });
    return;
  }

  // Import TicketHandler dynamically
  const { TicketHandler } = await import('../modules/ticket/ticketHandler');
  const handler = new TicketHandler();
  await handler.closeTicket(interaction, client, ticket.id);
}

async function handleReopen(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This command can only be used in a ticket channel.',
    });
    return;
  }

  // Find ticket by channel ID
  const tickets = await client.db.getAllTickets();
  const ticket = tickets.find((t: any) => t.channelId === channel.id);

  if (!ticket) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This is not a ticket channel.',
    });
    return;
  }

  if (ticket.state === 'open') {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This ticket is already open.',
    });
    return;
  }

  // Import TicketHandler dynamically
  const { TicketHandler } = await import('../modules/ticket/ticketHandler');
  const handler = new TicketHandler();
  await handler.reopenTicket(interaction, client, ticket.id);
}

async function handleRename(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This command can only be used in a ticket channel.',
    });
    return;
  }

  // Find ticket by channel ID
  const tickets = await client.db.getAllTickets();
  const ticket = tickets.find((t: any) => t.channelId === channel.id);

  if (!ticket) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This is not a ticket channel.',
    });
    return;
  }

  const newName = interaction.options.getString('name', true);
  const sanitizedName = newName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    if ('setName' in channel) {
      await channel.setName(sanitizedName);
      await interaction.editReply({
        content: `<:tcet_tick:1437995479567962184> Ticket channel renamed to **${sanitizedName}**`,
      });
    } else {
      await interaction.editReply({
        content: '<:tcet_cross:1437995480754946178> Unable to rename this channel.',
      });
    }
  } catch (error) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> Failed to rename the channel. Please check permissions.',
    });
  }
}

async function handleAddUser(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This command can only be used in a ticket channel.',
    });
    return;
  }

  // Find ticket by channel ID
  const tickets = await client.db.getAllTickets();
  const ticket = tickets.find((t: any) => t.channelId === channel.id);

  if (!ticket) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This is not a ticket channel.',
    });
    return;
  }

  const user = interaction.options.getUser('user', true);

  // Get panel to use configured permissions
  const panel = await client.db.get(ticket.panelId) as PanelData | null;
  const userPermissions = panel?.userPermissions || [];

  try {
    if ('permissionOverwrites' in channel) {
      // Build permission object based on panel configuration
      const permissions: any = {};
      
      if (userPermissions.length > 0) {
        // Use configured permissions
        for (const perm of userPermissions) {
          permissions[perm] = true;
        }
      } else {
        // Default permissions if none configured
        permissions.ViewChannel = true;
        permissions.SendMessages = true;
        permissions.ReadMessageHistory = true;
      }

      await channel.permissionOverwrites.edit(user.id, permissions);

      await interaction.editReply({
        content: `<:tcet_tick:1437995479567962184> Added <@${user.id}> to the ticket.`,
      });

      await channel.send({
        content: `<@${user.id}> has been added to the ticket by <@${interaction.user.id}>`,
      });
    } else {
      await interaction.editReply({
        content: '<:tcet_cross:1437995480754946178> Unable to modify permissions in this channel.',
      });
    }
  } catch (error) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> Failed to add user. Please check permissions.',
    });
  }
}

async function handleClaim(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This command can only be used in a ticket channel.',
    });
    return;
  }

  // Find ticket by channel ID
  const tickets = await client.db.getAllTickets();
  const ticket = tickets.find((t: any) => t.channelId === channel.id);

  if (!ticket) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This is not a ticket channel.',
    });
    return;
  }

  // Get panel to check staff role
  const panel = await client.db.get(ticket.panelId) as PanelData | null;
  const member = interaction.member as any;
  const isStaff = member?.roles?.cache?.has(panel?.staffRole || '') || interaction.memberPermissions?.has('ManageChannels');

  if (!isStaff) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> **Only staff members can claim tickets.**',
    });
    return;
  }

  if (ticket.claimedBy) {
    await interaction.editReply({
      content: `<:tcet_cross:1437995480754946178> **This ticket has already been claimed by <@${ticket.claimedBy}>**\n\nPlease ask them to unclaim it first if you need to claim it.`,
    });
    return;
  }

  // Update ticket
  ticket.claimedBy = interaction.user.id;
  client.db.save(ticket);

  // Rename channel
  try {
    if ('setName' in channel) {
      const newName = `claimed-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await channel.setName(newName);
    }
  } catch (error) {
    console.error('Failed to rename channel:', error);
  }

  // Send success embed (ephemeral to claimer)
  await interaction.editReply({
    content: '<:tcet_tick:1437995479567962184> **You have claimed this ticket.**\n\nYou are now responsible for helping the user.',
  });

  // Send public message
  const { EmbedBuilder } = await import('discord.js');
  const embed = new EmbedBuilder()
    .setTitle('<:tcet_tick:1437995479567962184> Ticket Claimed')
    .setDescription(`This ticket has been claimed by <@${interaction.user.id}>`)
    .setColor(0x57F287)
    .setTimestamp();

  if ('send' in channel) {
    await channel.send({ embeds: [embed] });
  }
}

async function handleUnclaim(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply({ flags: 1 << 6 }); // MessageFlags.Ephemeral

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This command can only be used in a ticket channel.',
    });
    return;
  }

  // Find ticket by channel ID
  const tickets = await client.db.getAllTickets();
  const ticket = tickets.find((t: any) => t.channelId === channel.id);

  if (!ticket) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This is not a ticket channel.',
    });
    return;
  }

  if (!ticket.claimedBy) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> This ticket is not claimed.',
    });
    return;
  }

  if (ticket.claimedBy !== interaction.user.id && !interaction.memberPermissions?.has('ManageChannels')) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> You can only unclaim tickets that you claimed.',
    });
    return;
  }

  // Get original owner username for channel name
  try {
    const owner = await client.users.fetch(ticket.owner);
    const claimedBy = ticket.claimedBy;
    
    // Update ticket
    ticket.claimedBy = undefined;
    client.db.save(ticket);

    // Rename channel back to original
    if ('setName' in channel) {
      const newName = `ticket-${owner.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await channel.setName(newName);
    }

    // Send success embed (ephemeral to unclaimer)
    await interaction.editReply({
      content: '<:tcet_tick:1437995479567962184> **You have unclaimed this ticket.**\n\nOther staff members can now claim it.',
    });

    // Send public message
    const { EmbedBuilder } = await import('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('<:tcet_tick:1437995479567962184> Ticket Unclaimed')
      .setDescription(`This ticket has been unclaimed by <@${claimedBy}>\n\nStaff members can now claim this ticket.`)
      .setColor(0xFEE75C)
      .setTimestamp();

    if ('send' in channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    await interaction.editReply({
      content: '<:tcet_cross:1437995480754946178> Failed to unclaim ticket. Please try again.',
    });
  }
}
