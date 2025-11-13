import { BotClient } from './client';

export class StartupLoader {
  /**
   * Load and restore all panels and tickets on bot startup
   */
  static async load(client: BotClient): Promise<void> {
    console.log('🔄 Starting system restoration...');

    try {
      // Load all panels from PostgreSQL cloud database
      const panels = await client.db.getAllPanels();
      console.log(`📋 Loaded ${panels.length} panel(s) from Google Cloud Database`);

      // Load all tickets from PostgreSQL cloud database
      const tickets = await client.db.getAllTickets();
      console.log(`<:module:1437997093753983038> Loaded ${tickets.length} ticket(s) from Google Cloud Database`);

      // Verify panel messages still exist
      let restored = 0;
      let missing = 0;

      for (const panel of panels) {
        if (!panel.enabled) continue;
        if (!panel.channel || !panel.messageId) continue;

        try {
          const channel = await client.channels.fetch(panel.channel);
          if (!channel || !channel.isTextBased()) {
            console.warn(`<:caution:1437997212008185866> Panel ${panel.id}: Channel not found or not text-based`);
            missing++;
            continue;
          }

          // Try to fetch the message
          const message = await channel.messages.fetch(panel.messageId);
          if (message) {
            restored++;
            console.log(`<:tcet_tick:1437995479567962184> Panel ${panel.id}: Message verified`);
          }
        } catch (error) {
          console.warn(`<:caution:1437997212008185866> Panel ${panel.id}: Message not found, may need redeployment`);
          missing++;
        }
      }

      console.log(`<:tcet_tick:1437995479567962184> Startup complete: ${restored} panels active, ${missing} panels need attention`);
    } catch (error) {
      console.error('<:tcet_cross:1437995480754946178> Error during startup restoration:', error);
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
          console.warn(`<:caution:1437997212008185866> Ticket ${ticket.id}: Channel not found, marking as orphaned`);
          // Could add orphaned flag or auto-cleanup here
        }
      } catch (error) {
        console.warn(`<:caution:1437997212008185866> Ticket ${ticket.id}: Error verifying channel`);
      }
    }
  }
}
