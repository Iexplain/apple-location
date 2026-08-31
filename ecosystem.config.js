// PM2 进程管理配置
// 用法: pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'apple-location',
    script: 'server/index.js',
    node_args: '--experimental-sqlite',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    max_memory_restart: '200M',
    restart_delay: 3000,
  }],
};
