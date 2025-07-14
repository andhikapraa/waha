#!/bin/bash

# WAHA Production Monitoring Setup Script

echo "Setting up monitoring for WAHA production deployment..."

# Create monitoring directories
sudo mkdir -p /var/log/waha
sudo mkdir -p /etc/logrotate.d

# Setup log rotation
cat > /tmp/waha-logrotate << EOF
/var/log/waha/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 waha waha
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

sudo mv /tmp/waha-logrotate /etc/logrotate.d/waha

# Setup health check script
cat > /tmp/health-check.sh << 'EOF'
#!/bin/bash

# WAHA Health Check Script
WAHA_URL="http://localhost:3000"
LOG_FILE="/var/log/waha/health-check.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Check API endpoint
response=$(curl -s -o /dev/null -w "%{http_code}" "$WAHA_URL/api/server/version")

if [ "$response" = "200" ]; then
    echo "[$DATE] WAHA is healthy (HTTP $response)" >> "$LOG_FILE"
    exit 0
else
    echo "[$DATE] WAHA is unhealthy (HTTP $response)" >> "$LOG_FILE"
    
    # Send alert (customize as needed)
    # curl -X POST -H 'Content-type: application/json' \
    #     --data '{"text":"WAHA is down! HTTP response: '$response'"}' \
    #     YOUR_SLACK_WEBHOOK_URL
    
    exit 1
fi
EOF

sudo mv /tmp/health-check.sh /usr/local/bin/waha-health-check.sh
sudo chmod +x /usr/local/bin/waha-health-check.sh

# Setup cron job for health checks
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/waha-health-check.sh") | crontab -

# Setup system monitoring script
cat > /tmp/system-monitor.sh << 'EOF'
#!/bin/bash

# System Resource Monitoring for WAHA
LOG_FILE="/var/log/waha/system-monitor.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Get system metrics
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')
MEMORY_USAGE=$(free | grep Mem | awk '{printf("%.2f", $3/$2 * 100.0)}')
DISK_USAGE=$(df -h / | awk 'NR==2{printf "%s", $5}' | sed 's/%//')

# Get WAHA process info
WAHA_PID=$(pgrep -f "waha")
if [ ! -z "$WAHA_PID" ]; then
    WAHA_CPU=$(ps -p $WAHA_PID -o %cpu --no-headers)
    WAHA_MEM=$(ps -p $WAHA_PID -o %mem --no-headers)
else
    WAHA_CPU="N/A"
    WAHA_MEM="N/A"
fi

# Log metrics
echo "[$DATE] System - CPU: ${CPU_USAGE}%, Memory: ${MEMORY_USAGE}%, Disk: ${DISK_USAGE}%" >> "$LOG_FILE"
echo "[$DATE] WAHA - CPU: ${WAHA_CPU}%, Memory: ${WAHA_MEM}%" >> "$LOG_FILE"

# Alert if resources are high
if (( $(echo "$CPU_USAGE > 80" | bc -l) )); then
    echo "[$DATE] WARNING: High CPU usage: ${CPU_USAGE}%" >> "$LOG_FILE"
fi

if (( $(echo "$MEMORY_USAGE > 80" | bc -l) )); then
    echo "[$DATE] WARNING: High memory usage: ${MEMORY_USAGE}%" >> "$LOG_FILE"
fi

if [ "$DISK_USAGE" -gt 80 ]; then
    echo "[$DATE] WARNING: High disk usage: ${DISK_USAGE}%" >> "$LOG_FILE"
fi
EOF

sudo mv /tmp/system-monitor.sh /usr/local/bin/waha-system-monitor.sh
sudo chmod +x /usr/local/bin/waha-system-monitor.sh

# Setup cron job for system monitoring
(crontab -l 2>/dev/null; echo "*/10 * * * * /usr/local/bin/waha-system-monitor.sh") | crontab -

# Setup backup script
cat > /tmp/backup.sh << 'EOF'
#!/bin/bash

# WAHA Backup Script
BACKUP_DIR="/backup/waha"
DATE=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="/var/log/waha/backup.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..." >> "$LOG_FILE"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database
if [ -f "/home/waha/waha/data/waha.db" ]; then
    cp "/home/waha/waha/data/waha.db" "$BACKUP_DIR/waha_${DATE}.db"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database backed up" >> "$LOG_FILE"
fi

# Backup configuration
tar -czf "$BACKUP_DIR/config_${DATE}.tar.gz" -C /home/waha/waha .env ecosystem.config.js

# Backup logs
tar -czf "$BACKUP_DIR/logs_${DATE}.tar.gz" -C /var/log/waha .

# Clean old backups (keep 7 days)
find "$BACKUP_DIR" -name "*.db" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completed" >> "$LOG_FILE"
EOF

sudo mv /tmp/backup.sh /usr/local/bin/waha-backup.sh
sudo chmod +x /usr/local/bin/waha-backup.sh

# Setup daily backup cron job
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/waha-backup.sh") | crontab -

echo "Monitoring setup completed!"
echo "Health checks: every 5 minutes"
echo "System monitoring: every 10 minutes"
echo "Daily backups: 2:00 AM"
echo "Logs location: /var/log/waha/"
