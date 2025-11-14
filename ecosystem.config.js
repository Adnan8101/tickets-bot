module.exports = {
  apps: [{
    name: 'beru-bot',
    script: './src/index.ts',
    interpreter: 'node',
    interpreter_args: '--loader ts-node/esm/transpile-only',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      TS_NODE_PROJECT: './tsconfig.json',
      NODE_OPTIONS: '--loader ts-node/esm/transpile-only'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
