import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { BotClient } from '../core/client';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Display bot status and system information');

export async function execute(
  interaction: ChatInputCommandInteraction,
  client: BotClient
): Promise<void> {
  await interaction.deferReply();

  const uptime = process.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const memoryUsage = process.memoryUsage();
  const memoryUsedMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
  const memoryTotalMB = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('Bot Status')
    .setDescription('Current system status and statistics')
    .addFields(
      {
        name: 'Uptime',
        value: `${days}d ${hours}h ${minutes}m ${seconds}s`,
        inline: false
      },
      {
        name: 'Servers',
        value: `${client.guilds.cache.size}`,
        inline: false
      },
      {
        name: 'Channels',
        value: `${client.channels.cache.size}`,
        inline: false
      },
      {
        name: 'Users',
        value: `${client.users.cache.size}`,
        inline: false
      },
      {
        name: 'Memory Usage',
        value: `${memoryUsedMB} MB / ${memoryTotalMB} MB`,
        inline: false
      },
      {
        name: 'Node Version',
        value: `${process.version}`,
        inline: false
      },
      {
        name: 'Discord.js Version',
        value: `v14.14.1`,
        inline: false
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
