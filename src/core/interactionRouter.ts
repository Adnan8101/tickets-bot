import { Interaction, InteractionType, ComponentType } from 'discord.js';
import { BotClient } from './client';

export interface InteractionHandler {
  execute(interaction: Interaction, client: BotClient, parts: string[]): Promise<void>;
}

export class InteractionRouter {
  private handlers: Map<string, InteractionHandler> = new Map();

  /**
   * Register a handler for a specific interaction pattern
   */
  register(pattern: string, handler: InteractionHandler): void {
    this.handlers.set(pattern, handler);
  }

  /**
   * Route an interaction to the appropriate handler
   */
  async route(interaction: Interaction, client: BotClient): Promise<void> {
    try {
      // Parse custom ID (format: system:action:id:extra)
      let customId: string;
      if (interaction.isButton()) {
        customId = interaction.customId;
      } else if (interaction.isStringSelectMenu()) {
        customId = interaction.customId;
      } else if (interaction.isModalSubmit()) {
        customId = interaction.customId;
      } else {
        return; // Not a component interaction
      }

      const parts = customId.split(':');
      const system = parts[0];
      const action = parts[1];

      // Check if this action opens a modal - if so, don't defer
      const modalActions = ['set-name', 'set-description', 'set-openmessage', 'add-question', 'set-label'];
      const shouldShowModal = modalActions.includes(action);

      // Actions that should use ephemeral reply instead of update
      const ephemeralActions = ['open'];
      const shouldUseEphemeral = ephemeralActions.includes(action);

      // Defer reply immediately to prevent "interaction failed" messages (except for modals and open action)
      if (!shouldShowModal && !shouldUseEphemeral && (interaction.isButton() || interaction.isStringSelectMenu())) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.deferUpdate().catch(() => {});
        }
      }

      // For open action with questions, it will show modal, otherwise defer with ephemeral reply
      if (shouldUseEphemeral && (interaction.isButton() || interaction.isStringSelectMenu())) {
        // Don't defer here - let the handler decide if it needs modal or ephemeral reply
      }

      // For modal submits, let the handler decide how to respond
      // Some modals need to reply with messages, others need to update
      // Do not automatically defer modal submits

      // Find matching handler
      const handler = this.handlers.get(system);
      if (handler) {
        await handler.execute(interaction, client, parts);
      } else {
        console.warn(`No handler found for system: ${system}`);
      }
    } catch (error) {
      console.error('Error routing interaction:', error);
      
      // Try to send error message
      try {
        const errorMessage = 'An error occurred while processing your interaction. Please try again.';
        
        if (interaction.isRepliable()) {
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMessage, components: [], embeds: [] }).catch(() => {});
          } else {
            await interaction.reply({ content: errorMessage, flags: 1 << 6 }).catch(() => {}); // MessageFlags.Ephemeral
          }
        }
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
    }
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): Map<string, InteractionHandler> {
    return this.handlers;
  }
}

export const router = new InteractionRouter();
