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
  const sent = await interaction.deferReply({ fetchReply: true });
  
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const apiLatency = Math.round(client.ws.ping);

  let latencyStatus = 'Excellent';
  let latencyColor = '#57F287'; // Green

  if (latency > 200 || apiLatency > 200) {
    latencyStatus = 'Good';
    latencyColor = '#FEE75C'; // Yellow
  }
  if (latency > 500 || apiLatency > 500) {
    latencyStatus = 'Poor';
    latencyColor = '#ED4245'; // Red
  }

  const embed = new EmbedBuilder()
    .setColor(latencyColor as any)
    .setTitle('Pong')
    .setDescription('Bot latency and response time')
    .addFields(
      {
        name: 'Bot Latency',
        value: `${latency}ms`,
        inline: false
      },
      {
        name: 'API Latency',
        value: `${apiLatency}ms`,
        inline: false
      },
      {
        name: 'Status',
        value: latencyStatus,
        inline: false
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
