import { BotClient } from './client';

export class StartupLoader {
  /**
   * Load and restore all panels and tickets on bot startup
   */
  static async load(client: BotClient): Promise<void> {

    try {
      // Load all panels from PostgreSQL cloud database
      const panels = await client.db.getAllPanels();

      // Load all tickets from PostgreSQL cloud database
      const tickets = await client.db.getAllTickets();

      // Verify panel messages still exist
      let restored = 0;
      let missing = 0;

      for (const panel of panels) {
        if (!panel.enabled) continue;
        if (!panel.channel || !panel.messageId) continue;

        try {
          const channel = await client.channels.fetch(panel.channel);
          if (!channel || !channel.isTextBased()) {
            missing++;
            continue;
          }

          // Try to fetch the message
          const message = await channel.messages.fetch(panel.messageId);
          if (message) {
            restored++;
          }
        } catch (error) {
          missing++;
        }
      }

    } catch (error) {
    }
  }

  /**
   * Verify ticket channels still exist
   */
  static async verifyTickets(client: BotClient): Promise<void> {
    const tickets = await client.db.getAllTickets();
    
    for (const ticket of tickets) {
      try {
        const channel = await client.channels.fetch(ticket.channelId);
        if (!channel) {
          // Could add orphaned flag or auto-cleanup here
        }
      } catch (error) {
      }
    }
  }
}
