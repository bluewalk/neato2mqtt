const mqtt = require('mqtt');
const { Client } = require('node-botvac');

const mqttServer = process.env.MQTT_SERVER || 'mqtt://localhost';
const email = process.env.NEATO_EMAIL;
const password = process.env.NEATO_PASSWORD;
const rootTopic = process.env.MQTT_ROOT_TOPIC || 'neato';

if (!email || !password) {
    throw new Error('NEATO_EMAIL and NEATO_PASSWORD environment variables are required');
}

const mqttClient = mqtt.connect(mqttServer);
const botvacClient = new Client();

function getState(robot) {
    robot.getState((error, state) => {
        if (error) {
            console.error('Authorization error:', error);
            return;
        }

        const topic = `${rootTopic}/${robot._serial}`;

        mqttClient.publish(`${topic}/state/availableServices`, JSON.stringify(state.availableServices));
        mqttClient.publish(`${topic}/state/isBinFull`, JSON.stringify(state.alert == "dustbin_full"));
        mqttClient.publish(`${topic}/state/isCharging`, JSON.stringify(state.details.isCharging));
        mqttClient.publish(`${topic}/state/isDocked`, JSON.stringify(state.details.isDocked));
        mqttClient.publish(`${topic}/state/isScheduleEnabled`, JSON.stringify(state.details.isScheduleEnabled));
        mqttClient.publish(`${topic}/state/dockHasBeenSeen`, JSON.stringify(state.details.dockHasBeenSeen));
        mqttClient.publish(`${topic}/state/charge`, JSON.stringify(state.details.charge));
        mqttClient.publish(`${topic}/state/canStart`, JSON.stringify(state.availableCommands.start));
        mqttClient.publish(`${topic}/state/canStop`, JSON.stringify(state.availableCommands.stop));
        mqttClient.publish(`${topic}/state/canPause`, JSON.stringify(state.availableCommands.pause));
        mqttClient.publish(`${topic}/state/canResume`, JSON.stringify(state.availableCommands.resume));
        mqttClient.publish(`${topic}/state/canGoToBase`, JSON.stringify(state.availableCommands.goToBase));
        mqttClient.publish(`${topic}/state/eco`, JSON.stringify(state.cleaning.mode === 1));

        if (state.cleaning.category === 4) {
            mqttClient.publish(`${topic}/state/noGoLines`, JSON.stringify(state));
        }
        else if (state.cleaning.category === 2) {
            mqttClient.publish(`${topic}/state/noGoLines`, JSON.stringify(state));
        }
        else if (mqttClient.publish(`${topic}/state/noGoLines`, JSON.stringify(state))) {
            mqttClient.publish(`${topic}/state/noGoLines`, JSON.stringify(state));
        }

        mqttClient.publish(`${topic}/state/navigationMode`, JSON.stringify(state.cleaning.navigationMode));
        mqttClient.publish(`${topic}/state/spotWidth`, JSON.stringify(state.cleaning.spotWidth));
        mqttClient.publish(`${topic}/state/spotHeight`, JSON.stringify(state.cleaning.spotHeight));
        mqttClient.publish(`${topic}/state/spotRepeat`, JSON.stringify(state.cleaning.modifier === 2));
        mqttClient.publish(`${topic}/state/cleaningBoundaryId`, JSON.stringify(state.cleaning.boundaryId));

        mqttClient.publish(`${topic}/state/lastUpdate`, new Date().toISOString());
    });
}

botvacClient.authorize(email, password, false, (error) => {
    if (error) {
        console.error('Authorization error:', error);
        return;
    }
    console.log('Authorized with API');

    botvacClient.getRobots((error, robots) => {
        if (error) {
            console.error('Error getting robots:', error);
            return;
        }

        robots.forEach(robot => {
            console.log('Found robot:', robot._serial);

            const topic = `${rootTopic}/${robot._serial}`;
            const message = JSON.stringify({
                name: robot.name,
                model: robot.modelName,
                isOnline: robot.isOnline
            });

            mqttClient.publish(`${topic}/name`, robot.name, {}, (error) => {
                if (error) {
                    console.error(`Error publishing to ${topic}:`, error);
                } else {
                    console.log(`Published robot details to ${topic}`);
                }
            });

            mqttClient.subscribe(`${topic}/command`);

            getState(robot);
        });
    });

    setInterval(() => {
        botvacClient.getRobots((error, robots) => {
            if (error) {
                console.error('Error getting robots:', error);
                return;
            }

            robots.forEach(robot => {
                getState(robot);
            });
        });
    }, 5 * 60 * 1000);
});

mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
});

mqttClient.on('message', (topic, message) => {
    // Adjusted to match the new topic format "${rootTopic}/<serial_number>/command"
    const parts = topic.split('/');
    if (parts[0] === 'neato' && parts[2] === 'command') {
        const serialNumber = parts[1];
        const command = message.toString();

        botvacClient.getRobots((error, robots) => {
            if (error) {
                console.error('Error getting robots:', error);
                return;
            }

            // Find the robot with the matching serial number
            const robot = robots.find(r => r._serial === serialNumber);
            if (!robot) {
                console.error(`Robot with serial ${serialNumber} not found`);
                return;
            }

            if (command === 'start_cleaning') {
                // Start cleaning with no-go lines enabled
                robot.startCleaning(true, 1, true, (error, body) => {
                    if (error) {
                        mqttClient.publish(`${rootTopic}/${serialNumber}/error`, body);
                        console.error('Error starting cleaning:', error, body);
                    } else {
                        console.log(`Cleaning started for robot ${serialNumber} with no-go lines enabled`);
                    }
                });
            }

            if (command === 'stop_cleaning') {
                robot.stopCleaning((error, body) => {
                    if (error) {
                        mqttClient.publish(`${rootTopic}/${serialNumber}/error`, body);
                        console.error('Error stopping cleaning:', error, body);
                    } else {
                        console.log(`Cleaning stopped for robot ${serialNumber}`);
                    }
                });
            }

            if (command === 'pause_cleaning') {
                robot.pauseCleaning((error, body) => {
                    if (error) {
                        mqttClient.publish(`${rootTopic}/${serialNumber}/error`, body);
                        console.error('Error pausing cleaning:', error, body);
                    } else {
                        console.log(`Cleaning paused for robot ${serialNumber}`);
                    }
                });
            }

            if (command === 'resume_cleaning') {
                robot.resumeCleaning((error, body) => {
                    if (error) {
                        mqttClient.publish(`${rootTopic}/${serialNumber}/error`, body);
                        console.error('Error resuming cleaning:', error, body);
                    } else {
                        console.log(`Cleaning resumed for robot ${serialNumber}`);
                    }
                });
            }

            if (command === 'send_to_base') {
                robot.sendToBase((error, body) => {
                    if (error) {
                        mqttClient.publish(`${rootTopic}/${serialNumber}/error`, body);
                        console.error('Error sending robot to base:', error, body);
                    } else {
                        console.log(`Robot ${serialNumber} sent to base`);
                    }
                });
            }
        });
    }
});

console.log('Application is running...');