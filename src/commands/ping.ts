import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { BotClient } from '../core/client';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot latency and response time');

export async function execute(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  const sent = await interaction.reply({ content: '🏓', fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  await interaction.editReply({ content: `🏓 **${latency}ms**` });
}
