// PM2 Ecosystem Configuration for WAHA Production
module.exports = {
  apps: [
    {
      name: 'waha-prod',
      script: 'dist/main.js',
      cwd: '/home/waha/waha',
      instances: 'max', // Use all CPU cores
      exec_mode: 'cluster',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        
        // Authentication
        WAHA_AUTH_ENABLED: 'true',
        WAHA_JWT_SECRET: process.env.WAHA_JWT_SECRET,
        WAHA_JWT_EXPIRES_IN: '24h',
        WAHA_REFRESH_TOKEN_EXPIRES_IN: '7d',
        WAHA_DEFAULT_ADMIN_PASSWORD: process.env.WAHA_DEFAULT_ADMIN_PASSWORD,
        
        // API Configuration
        WAHA_API_KEY: process.env.WAHA_API_KEY,
        
        // Database
        WAHA_DATABASE_URL: 'file:./data/waha.db',
        
        // Security
        WAHA_CORS_ORIGIN: process.env.WAHA_CORS_ORIGIN || '*',
        WAHA_RATE_LIMIT_MAX: '100',
        WAHA_RATE_LIMIT_WINDOW: '15',
        
        // Logging
        WAHA_LOG_LEVEL: 'info',
        WAHA_LOG_FORMAT: 'json',
      },
      
      // Logging
      log_file: '/home/waha/logs/waha.log',
      out_file: '/home/waha/logs/waha-out.log',
      error_file: '/home/waha/logs/waha-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Process management
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 4000,
      
      // Health monitoring
      min_uptime: '10s',
      max_restarts: 10,
      
      // Advanced options
      node_args: '--max-old-space-size=2048',
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Environment-specific overrides
      env_production: {
        NODE_ENV: 'production',
        instances: 'max',
        exec_mode: 'cluster'
      }
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'waha',
      host: ['your-server-ip'],
      ref: 'origin/main',
      repo: 'https://github.com/andhikapraa/waha.git',
      path: '/home/waha/waha',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt update && apt install git -y'
    }
  }
};
