const mqtt = require('mqtt');
const { Client } = require('node-botvac');

const mqttServer = process.env.MQTT_HOST || 'mqtt://localhost';
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

        let data = {
            availableServices: JSON.stringify(state.availableServices),
            isBinFull: JSON.stringify(state.alert == "dustbin_full"),
            isCharging: JSON.stringify(state.details.isCharging),
            isDocked: JSON.stringify(state.details.isDocked),
            isScheduleEnabled: JSON.stringify(state.details.isScheduleEnabled),
            dockHasBeenSeen: JSON.stringify(state.details.dockHasBeenSeen),
            charge: JSON.stringify(state.details.charge),
            canStart: JSON.stringify(state.availableCommands.start),
            canStop: JSON.stringify(state.availableCommands.stop),
            canPause: JSON.stringify(state.availableCommands.pause),
            canResume: JSON.stringify(state.availableCommands.resume),
            canGoToBase: JSON.stringify(state.availableCommands.goToBase),
            eco: JSON.stringify(state.cleaning.mode === 1),
            noGoLines: state.cleaning.category === 4,
            navigationMode: JSON.stringify(state.cleaning.navigationMode),
            spotWidth: JSON.stringify(state.cleaning.spotWidth),
            spotHeight: JSON.stringify(state.cleaning.spotHeight),
            spotRepeat: JSON.stringify(state.cleaning.modifier === 2),
            cleaningBoundaryId: JSON.stringify(state.cleaning.boundaryId),
            lastUpdate: new Date().toISOString()
        }

        mqttClient.publish(`${rootTopic}/${robot._serial}/state`, JSON.stringify(data));
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