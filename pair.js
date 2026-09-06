import express from 'express';
import fs from 'fs';
import pino from 'pino';
import zlib from 'zlib';

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import pn from 'awesome-phonenumber';

const router = express.Router();


// ============================================
// REMOVE FILE / DIRECTORY
// ============================================

function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;

        fs.rmSync(filePath, {
            recursive: true,
            force: true
        });

        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}


// ============================================
// CREATE YASMIN SESSION
// ============================================

function createYasminSession(credsPath) {
    /*
     * Read creds.json
     */
    const creds = fs.readFileSync(credsPath);

    /*
     * Compress creds.json using gzip
     *
     * H4sIA... is the Base64 representation
     * of gzip-compressed data.
     */
    const compressed = zlib.gzipSync(creds);

    /*
     * Convert gzip data to Base64
     */
    const base64 = compressed.toString('base64');

    /*
     * Final Yasmin MD session format:
     *
     * YASMIN!H4sIAAAAAAAAA...
     */
    return `YASMIN!${base64}`;
}


// ============================================
// PAIRING ROUTE
// ============================================

router.get('/', async (req, res) => {

    let num = req.query.number;

    if (!num) {
        return res.status(400).send({
            code: 'Please provide a phone number.'
        });
    }

    /*
     * Temporary session directory
     */
    let dirs = './' + num;


    // ========================================
    // REMOVE EXISTING TEMP SESSION
    // ========================================

    await removeFile(dirs);


    // ========================================
    // CLEAN PHONE NUMBER
    // ========================================

    num = String(num).replace(/[^0-9]/g, '');


    // ========================================
    // VALIDATE PHONE NUMBER
    // ========================================

    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).send({
            code:
                'Invalid phone number. Please enter your full international number without + or spaces.'
        });
    }


    // ========================================
    // NORMALIZE PHONE NUMBER
    // ========================================

    num = phone
        .getNumber('e164')
        .replace('+', '');


    // ========================================
    // START TEMPORARY BAILEYS SESSION
    // ========================================

    async function initiateSession() {

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(dirs);


        try {

            const {
                version
            } = await fetchLatestBaileysVersion();


            const logger = pino({
                level: 'fatal'
            }).child({
                level: 'fatal'
            });


            const YASMIN = makeWASocket({

                version,

                auth: {
                    creds: state.creds,

                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
                },

                printQRInTerminal: false,

                logger,

                browser: Browsers.windows('Chrome'),

                markOnlineOnConnect: false,

                generateHighQualityLinkPreview: false,

                defaultQueryTimeoutMs: 60000,

                connectTimeoutMs: 60000,

                keepAliveIntervalMs: 30000,

                retryRequestDelayMs: 250,

                maxRetries: 5
            });


            // ====================================
            // SAVE CREDENTIAL CHANGES
            // ====================================

            YASMIN.ev.on(
                'creds.update',
                saveCreds
            );


            // ====================================
            // CONNECTION UPDATE
            // ====================================

            YASMIN.ev.on(
                'connection.update',
                async (update) => {

                    const {
                        connection,
                        lastDisconnect,
                        isNewLogin,
                        isOnline
                    } = update;


                    // =================================
                    // SUCCESSFULLY CONNECTED
                    // =================================

                    if (connection === 'open') {

                        console.log(
                            '✅ Connected successfully!'
                        );

                        console.log(
                            '📦 Creating YASMIN session...'
                        );


                        try {

                            const credsPath =
                                dirs + '/creds.json';


                            // Make sure creds.json exists
                            if (!fs.existsSync(credsPath)) {

                                throw new Error(
                                    'creds.json was not created.'
                                );

                            }


                            // =================================
                            // CREATE SESSION STRING
                            // =================================

                            const session =
                                createYasminSession(
                                    credsPath
                                );


                            console.log(
                                '✅ YASMIN session created!'
                            );


                            // =================================
                            // USER JID
                            // =================================

                            const userJid =
                                jidNormalizedUser(
                                    num +
                                    '@s.whatsapp.net'
                                );


                            // =================================
                            // SEND SESSION
                            // =================================

                            await YASMIN.sendMessage(
                                userJid,
                                {
                                    text:
                                        `*YASMIN MD SESSION*\n\n` +
                                        session +
                                        `\n\n` +
                                        `⚠️ Keep this session private.`
                                }
                            );


                            console.log(
                                '📤 YASMIN session sent successfully!'
                            );


                            // =================================
                            // WARNING MESSAGE
                            // =================================

                            await YASMIN.sendMessage(
                                userJid,
                                {
                                    text:
                                        `Send this to Yousef.\n\n` +
                                        `> YASMIN MD`
                                }
                            );


                            console.log(
                                '⚠️ Warning message sent successfully'
                            );


                            // =================================
                            // CLEANUP
                            // =================================

                            console.log(
                                '🧹 Cleaning up session...'
                            );


                            await delay(1000);


                            removeFile(dirs);


                            console.log(
                                '✅ Session cleaned up successfully!'
                            );


                            console.log(
                                '🎉 Process completed successfully!'
                            );


                        } catch (error) {

                            console.error(
                                '❌ Error creating/sending session:',
                                error
                            );


                            /*
                             * Cleanup even if sending fails
                             */
                            removeFile(dirs);

                        }

                    }


                    // =================================
                    // NEW LOGIN
                    // =================================

                    if (isNewLogin) {

                        console.log(
                            '🔐 New login via pair code'
                        );

                    }


                    // =================================
                    // ONLINE
                    // =================================

                    if (isOnline) {

                        console.log(
                            '📶 Client is online'
                        );

                    }


                    // =================================
                    // CONNECTION CLOSED
                    // =================================

                    if (connection === 'close') {

                        const statusCode =
                            lastDisconnect
                                ?.error
                                ?.output
                                ?.statusCode;


                        if (statusCode === 401) {

                            console.log(
                                '❌ Logged out from WhatsApp. Need to generate a new pair code.'
                            );

                            removeFile(dirs);

                            return;

                        }


                        console.log(
                            '🔁 Connection closed — restarting...'
                        );


                        /*
                         * Only restart if the temporary
                         * session still exists.
                         */
                        if (fs.existsSync(dirs)) {

                            await initiateSession();

                        }

                    }

                }
            );


            // ========================================
            // REQUEST PAIRING CODE
            // ========================================

            if (!state.creds.registered) {

                /*
                 * Give Baileys a moment to initialize
                 */
                await delay(3000);


                try {

                    let code =
                        await YASMIN.requestPairingCode(
                            num
                        );


                    /*
                     * Format:
                     *
                     * ABCD-EFGH
                     */
                    code =
                        code
                            ?.match(/.{1,4}/g)
                            ?.join('-') ||
                        code;


                    if (!res.headersSent) {

                        console.log({
                            num,
                            code
                        });


                        await res.send({
                            code
                        });

                    }

                } catch (error) {

                    console.error(
                        'Error requesting pairing code:',
                        error
                    );


                    if (!res.headersSent) {

                        res.status(503).send({
                            code:
                                'Failed to get pairing code. Please check your phone number and try again.'
                        });

                    }

                }

            }

        } catch (err) {

            console.error(
                'Error initializing session:',
                err
            );


            if (!res.headersSent) {

                res.status(503).send({
                    code:
                        'Service Unavailable'
                });

            }

        }

    }


    await initiateSession();

});


// ============================================
// GLOBAL ERROR HANDLER
// ============================================

process.on(
    'uncaughtException',
    (err) => {

        const e = String(err);


        if (e.includes('conflict')) return;

        if (e.includes('not-authorized')) return;

        if (e.includes('Socket connection timeout')) return;

        if (e.includes('rate-overlimit')) return;

        if (e.includes('Connection Closed')) return;

        if (e.includes('Timed Out')) return;

        if (e.includes('Value not found')) return;

        if (e.includes('Stream Errored')) return;

        if (e.includes(
            'Stream Errored (restart required)'
        )) return;

        if (e.includes('statusCode: 515')) return;

        if (e.includes('statusCode: 503')) return;


        console.log(
            'Caught exception:',
            err
        );

    }
);


export default router;
