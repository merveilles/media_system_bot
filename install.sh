#! /bin/bash

npm install nedb-promises express dotenv body-parser request @slack/events-api fast-deep-equal
cp media_system.service /lib/systemd/system/
cp media_system.conf /etc/nginx/sites-enabled/
node init.js

nginx reload

systemctl daemon-reload
systemctl start media_system