import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { BotClient } from '../core/client';
export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot latency');

export async function execute(interaction: ChatInputCommandInteraction) {
  const start = Date.now();
  await interaction.reply("🏓");
  const latency = Date.now() - start;

  await interaction.editReply(`🏓 **${latency}ms** | API: ${Math.round(interaction.client.ws.ping)}ms`);
}