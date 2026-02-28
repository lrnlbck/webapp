// PM2 Ecosystem Config – TüTool App
// Startet den Node.js Server mit automatischem Neustart

module.exports = {
    apps: [{
        name: 'tuetool',
        script: 'server.js',
        cwd: '/var/www/webapp.lml-med.de',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '512M',
        env: {
            NODE_ENV: 'production',
            PORT: 3000
        },
        log_file: '/var/log/tuetool/combined.log',
        out_file: '/var/log/tuetool/out.log',
        error_file: '/var/log/tuetool/error.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        merge_logs: true
    }]
};
