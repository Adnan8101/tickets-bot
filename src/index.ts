import { config } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { createClient } from './core/client';
import { router } from './core/interactionRouter';
import { prefixHandler } from './core/prefixCommandHandler';
import { StartupLoader } from './core/startupLoader';
import { ErrorHandler } from './core/errorHandler';
import { EmbedController } from './core/embedController';
import { SetupWizardHandler } from './modules/ticket/setupWizard';
import { TicketHandler } from './modules/ticket/ticketHandler';
import { PanelHandler } from './modules/panel/panelHandler';
import { ActivityType } from 'discord.js';
import * as ticketCommand from './commands/ticket';
import * as statusCommand from './commands/status';
import * as pingCommand from './commands/ping';
import * as aboutCommand from './commands/about';
import * as setprefixCommand from './commands/setprefix';
import * as panelCommand from './commands/panel';

// Load environment variables
config();

console.log('🔧 Loading environment variables...');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing required environment variables: DISCORD_TOKEN or CLIENT_ID');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log('📦 Initializing bot...');

// Create client
const client = createClient();
console.log('✅ Client created');

// Register interaction handlers
router.register('wizard', new SetupWizardHandler());
router.register('ticket', new TicketHandler());
router.register('panel', new PanelHandler());
console.log('✅ Interaction handlers registered');

// Register commands
client.commands.set('ticket', ticketCommand);
client.commands.set('status', statusCommand);
client.commands.set('ping', pingCommand);
client.commands.set('about', aboutCommand);
client.commands.set('setprefix', setprefixCommand);
client.commands.set('panel', panelCommand);
console.log('✅ Commands registered');

// Event: Ready (using clientReady to avoid deprecation warning)
client.once('clientReady', async () => {
  console.log('\n🤖 Bot is online!');
  console.log(`📝 Logged in as ${client.user?.tag}`);

  // Wait for database connection
  console.log('🔌 Waiting for database connection...');
  const dbConnected = await client.db.waitForConnection(30000);
  if (!dbConnected) {
    console.error('❌ Database connection timeout');
    process.exit(1);
  }
  console.log('✅ Database connected');

  // Set bot name for embeds
  if (client.user?.username) {
    EmbedController.setBotName(client.user.username);
  }

  // Register slash commands
  console.log('📋 Registering slash commands...');
  await registerCommands();
  console.log('✅ Slash commands registered');

  // Load startup data
  console.log('📂 Loading startup data...');
  await StartupLoader.load(client);
  console.log('✅ Startup data loaded');

  // Set bot activity status
  client.user?.setPresence({
    activities: [{
      name: 'Managing your tickets',
      type: ActivityType.Custom,
      state: '🎫 Managing your tickets'
    }],
    status: 'online'
  });

  console.log('\n✨ Bot is ready to handle tickets!\n');
});

// Event: Interaction Create
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) {
        await command.execute(interaction, client);
      }
    } else if (interaction.isAutocomplete()) {
      // Handle autocomplete for panel command
      if (interaction.commandName === 'panel') {
        try {
          const focusedOption = interaction.options.getFocused(true);
          if (focusedOption.name === 'panel-name') {
            const panels = await client.db.getAllPanels();
            const choices = panels
              .filter(p => p.name)
              .map(p => ({ name: p.name!, value: p.name! }))
              .filter(choice => choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
              .slice(0, 25);
            await interaction.respond(choices);
          }
        } catch (error) {
          await interaction.respond([]).catch(() => {});
        }
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

// Event: Message Create (for prefix commands)
client.on('messageCreate', async message => {
  try {
    await prefixHandler.handleMessage(message, client);
  } catch (error) {
    ErrorHandler.handle(error as Error, 'Message handler');
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
      aboutCommand.data.toJSON(),
      setprefixCommand.data.toJSON(),
      panelCommand.data.toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN!);


    await rest.put(Routes.applicationCommands(CLIENT_ID!), {
      body: commands,
    });

  } catch (error) {
    ErrorHandler.handle(error as Error, 'Register commands');
  }
}

// Login
console.log('🔐 Logging in to Discord...');
client.login(TOKEN).catch(error => {
  console.error('❌ Failed to login:', error.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  client.db.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  client.db.close();
  client.destroy();
  process.exit(0);
});
