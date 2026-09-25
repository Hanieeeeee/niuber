# External cron (alternative to in-process node-cron)
# crontab -e
# Disable in-process scheduler first: RR_DISABLE_SCHEDULER=1

*/30 * * * * cd /opt/ring-records && /usr/bin/npm run sync >> /var/log/ring-records-sync.log 2>&1

# --- systemd timer example ---
# /etc/systemd/system/ring-records-sync.service
# [Unit]
# Description=Ring Records official sync
# [Service]
# Type=oneshot
# WorkingDirectory=/opt/ring-records
# ExecStart=/usr/bin/npm run sync
# EnvironmentFile=/opt/ring-records/.env
#
# /etc/systemd/system/ring-records-sync.timer
# [Unit]
# Description=Run Ring Records sync every 30 minutes
# [Timer]
# OnBootSec=2min
# OnUnitActiveSec=30min
# [Install]
# WantedBy=timers.target

# --- PM2 ---
# pm2 start npm --name ring-records -- start
# pm2 save && pm2 startup
