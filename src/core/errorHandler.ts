import { Interaction, EmbedBuilder } from 'discord.js';

export class ErrorHandler {
  /**
   * Handle and log errors globally
   */
  static handle(error: Error, context?: string): void {
  }

  /**
   * Send error message to user
   */
  static async sendError(
    interaction: Interaction,
    message: string = 'An error occurred. Please try again later.'
  ): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setTitle('<:tcet_cross:1437995480754946178> Error')
        .setDescription(message)
        .setColor(null)
        .setTimestamp();

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ embeds: [embed], components: [] });
        } else {
          await interaction.reply({ embeds: [embed], flags: 1 << 6 }); // MessageFlags.Ephemeral
        }
      }
    } catch (error) {
    }
  }

  /**
   * Log info message
   */
  static info(message: string): void {
  }

  /**
   * Log warning message
   */
  static warn(message: string): void {
  }
}
