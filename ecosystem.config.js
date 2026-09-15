// PM2 进程管理配置
// 用法: pm2 start ecosystem.config.js
//
// 单进程模式：server/index.js 同时启动 :3000(HTTP)、:8444(HTTPS)、:8445(wloc)。
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
