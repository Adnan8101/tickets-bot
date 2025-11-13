import { config } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { createClient } from './core/client';
import { router } from './core/interactionRouter';
import { StartupLoader } from './core/startupLoader';
import { ErrorHandler } from './core/errorHandler';
import { EmbedController } from './core/embedController';
import { SetupWizardHandler } from './modules/ticket/setupWizard';
import { TicketHandler } from './modules/ticket/ticketHandler';
import * as ticketCommand from './commands/ticket';
import * as statusCommand from './commands/status';
import * as pingCommand from './commands/ping';
import * as aboutCommand from './commands/about';

// Load environment variables
config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('<:tcet_cross:1437995480754946178> Missing DISCORD_TOKEN or CLIENT_ID in environment variables');
  process.exit(1);
}

// Create client
const client = createClient();

// Register interaction handlers
router.register('wizard', new SetupWizardHandler());
router.register('ticket', new TicketHandler());

// Register commands
client.commands.set('ticket', ticketCommand);
client.commands.set('status', statusCommand);
client.commands.set('ping', pingCommand);
client.commands.set('about', aboutCommand);

// Event: Ready (using clientReady to avoid deprecation warning)
client.once('clientReady', async () => {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  <:module:1437997093753983038>  BERU TICKETS 2.0                 ║');
  console.log('║  Powered by Universal Interaction      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n<:tcet_tick:1437995479567962184> Logged in as ${client.user?.tag}`);
  console.log(`<:k9logging:1437996243803705354> Serving ${client.guilds.cache.size} server(s)\n`);

  // Set bot name for embeds
  if (client.user?.username) {
    EmbedController.setBotName(client.user.username);
  }

  // Register slash commands
  await registerCommands();

  // Load startup data
  await StartupLoader.load(client);

  console.log('\n✨ Bot is ready!\n');
});

// Event: Interaction Create
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) {
        await command.execute(interaction, client);
      }
    } else if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    ) {
      await router.route(interaction, client);
    }
  } catch (error) {
    ErrorHandler.handle(error as Error, 'Interaction handler');
  }
});

// Event: Error
client.on('error', error => {
  ErrorHandler.handle(error, 'Discord Client');
});

// Register slash commands
async function registerCommands(): Promise<void> {
  try {
    const commands = [
      ticketCommand.data.toJSON(),
      statusCommand.data.toJSON(),
      pingCommand.data.toJSON(),
      aboutCommand.data.toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN!);

    console.log('🔄 Registering slash commands...');

    await rest.put(Routes.applicationCommands(CLIENT_ID!), {
      body: commands,
    });

    console.log('<:tcet_tick:1437995479567962184> Slash commands registered successfully');
  } catch (error) {
    ErrorHandler.handle(error as Error, 'Register commands');
  }
}

// Login
client.login(TOKEN).catch(error => {
  console.error('<:tcet_cross:1437995480754946178> Failed to login:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  client.db.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  client.db.close();
  client.destroy();
  process.exit(0);
});
