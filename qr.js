import express from 'express';
import fs from 'fs';
import pino from 'pino';
import zlib from 'zlib';
import QRCode from 'qrcode';

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

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

    const creds = fs.readFileSync(credsPath);

    const compressed = zlib.gzipSync(creds);

    const base64 = compressed.toString('base64');

    return `YASMIN!${base64}`;
}


// ============================================
// QR ROUTE
// ============================================

router.get('/', async (req, res) => {

    /*
     * Every request gets its own temporary session.
     * This prevents multiple QR requests from
     * interfering with each other.
     */

    const sessionId =
        Date.now().toString() +
        Math.random()
            .toString(36)
            .substring(2, 11);

    const dirs =
        `./qr_sessions/session_${sessionId}`;


    // ========================================
    // CREATE SESSION DIRECTORY
    // ========================================

    if (!fs.existsSync('./qr_sessions')) {

        fs.mkdirSync(
            './qr_sessions',
            {
                recursive: true
            }
        );

    }


    if (!fs.existsSync(dirs)) {

        fs.mkdirSync(
            dirs,
            {
                recursive: true
            }
        );

    }


    // ========================================
    // SESSION STATE
    // ========================================

    let qrGenerated = false;
    let responseSent = false;
    let sessionSent = false;


    // ========================================
    // CLEANUP
    // ========================================

    const cleanup = () => {

        if (fs.existsSync(dirs)) {

            console.log(
                '🧹 Cleaning up session...'
            );

            removeFile(dirs);

            console.log(
                '✅ Session cleaned up successfully!'
            );

        }

    };


    // ========================================
    // INITIATE SESSION
    // ========================================

    async function initiateSession() {

        try {

            const {
                state,
                saveCreds
            } = await useMultiFileAuthState(dirs);


            // ====================================
            // BAILEYS VERSION
            // ====================================

            const {
                version
            } = await fetchLatestBaileysVersion();


            // ====================================
            // LOGGER
            // ====================================

            const logger = pino({
                level: 'fatal'
            }).child({
                level: 'fatal'
            });


            // ====================================
            // CREATE SOCKET
            // ====================================

            const YASMIN = makeWASocket({

                version,

                auth: {
                    creds: state.creds,

                    keys:
                        makeCacheableSignalKeyStore(
                            state.keys,
                            logger
                        )
                },

                printQRInTerminal: false,

                logger,

                browser:
                    Browsers.macOS('Safari'),

                markOnlineOnConnect: false,

                generateHighQualityLinkPreview: false,

                defaultQueryTimeoutMs: 60000,

                connectTimeoutMs: 60000,

                keepAliveIntervalMs: 30000,

                retryRequestDelayMs: 250,

                maxRetries: 5

            });


            // ====================================
            // SAVE CREDS
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
                        qr,
                        isNewLogin,
                        isOnline
                    } = update;


                    // =================================
                    // QR GENERATED
                    // =================================

                    if (
                        qr &&
                        !qrGenerated &&
                        !responseSent
                    ) {

                        qrGenerated = true;

                        console.log(
                            '🟢 QR Code Generated!'
                        );


                        try {

                            const qrDataURL =
                                await QRCode.toDataURL(
                                    qr,
                                    {
                                        errorCorrectionLevel:
                                            'M',

                                        type:
                                            'image/png',

                                        quality:
                                            0.92,

                                        margin: 1,

                                        color: {
                                            dark:
                                                '#000000',

                                            light:
                                                '#FFFFFF'
                                        }
                                    }
                                );


                            responseSent = true;


                            await res.send({

                                qr: qrDataURL,

                                message:
                                    'QR Code Generated! Scan it with your WhatsApp app.',

                                instructions: [

                                    '1. Open WhatsApp on your phone',

                                    '2. Go to Settings > Linked Devices',

                                    '3. Tap "Link a Device"',

                                    '4. Scan the QR code above'

                                ]

                            });


                            console.log(
                                '📤 QR code sent to client'
                            );


                        } catch (error) {

                            console.error(
                                '❌ Error generating QR:',
                                error
                            );


                            if (!res.headersSent) {

                                responseSent = true;

                                res.status(500).send({

                                    code:
                                        'Failed to generate QR code'

                                });

                            }

                            cleanup();

                        }

                    }


                    // =================================
                    // NEW LOGIN
                    // =================================

                    if (isNewLogin) {

                        console.log(
                            '🔐 New login detected'
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
                    // CONNECTION OPEN
                    // =================================

                    if (
                        connection === 'open' &&
                        !sessionSent
                    ) {

                        sessionSent = true;

                        console.log(
                            '✅ Connected successfully!'
                        );

                        console.log(
                            '📦 Creating YASMIN session...'
                        );


                        try {

                            // =================================
                            // CREDS PATH
                            // =================================

                            const credsPath =
                                dirs +
                                '/creds.json';


                            // =================================
                            // MAKE SURE CREDS EXISTS
                            // =================================

                            if (
                                !fs.existsSync(
                                    credsPath
                                )
                            ) {

                                throw new Error(
                                    'creds.json was not created.'
                                );

                            }


                            // =================================
                            // CREATE YASMIN SESSION
                            // =================================

                            const session =
                                createYasminSession(
                                    credsPath
                                );


                            console.log(
                                '✅ YASMIN session created!'
                            );


                            // =================================
                            // GET USER JID
                            // =================================

                            const userJid =
                                jidNormalizedUser(
                                    YASMIN.user.id
                                );


                            if (!userJid) {

                                throw new Error(
                                    'Could not determine user JID.'
                                );

                            }


                            console.log(
                                `📱 User JID: ${userJid}`
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
                                        `> ۞ YASMIN MD`
                                }
                            );


                            console.log(
                                '⚠️ Warning message sent successfully'
                            );


                            // =================================
                            // CLEANUP
                            // =================================

                            await delay(1000);

                            cleanup();


                            console.log(
                                '🎉 Process completed successfully!'
                            );


                        } catch (error) {

                            console.error(
                                '❌ Error creating/sending session:',
                                error
                            );

                            cleanup();

                        }

                    }


                    // =================================
                    // CONNECTION CLOSED
                    // =================================

                    if (
                        connection === 'close'
                    ) {

                        const statusCode =
                            lastDisconnect
                                ?.error
                                ?.output
                                ?.statusCode;


                        // =================================
                        // LOGGED OUT
                        // =================================

                        if (
                            statusCode === 401
                        ) {

                            console.log(
                                '❌ Logged out from WhatsApp.'
                            );

                            cleanup();

                            return;

                        }


                        // =================================
                        // TEMPORARY CONNECTION ERROR
                        // =================================

                        console.log(
                            '🔁 Connection closed — restarting...'
                        );


                        /*
                         * Only reconnect if the temporary
                         * session still exists and the
                         * session hasn't already completed.
                         */

                        if (
                            fs.existsSync(dirs) &&
                            !sessionSent
                        ) {

                            await delay(2000);

                            await initiateSession();

                        }

                    }

                }
            );


            // ========================================
            // QR TIMEOUT
            // ========================================

            setTimeout(() => {

                if (
                    !qrGenerated &&
                    !responseSent &&
                    fs.existsSync(dirs)
                ) {

                    responseSent = true;

                    console.log(
                        '⏱️ QR generation timed out.'
                    );


                    if (!res.headersSent) {

                        res.status(408).send({

                            code:
                                'QR generation timeout'

                        });

                    }

                    cleanup();

                }

            }, 30000);


        } catch (error) {

            console.error(
                '❌ Error initializing session:',
                error
            );


            if (!res.headersSent) {

                res.status(503).send({

                    code:
                        'Service Unavailable'

                });

            }

            cleanup();

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

        if (
            e.includes(
                'Socket connection timeout'
            )
        ) return;

        if (
            e.includes('rate-overlimit')
        ) return;

        if (
            e.includes('Connection Closed')
        ) return;

        if (
            e.includes('Timed Out')
        ) return;

        if (
            e.includes('Value not found')
        ) return;

        if (
            e.includes('Stream Errored')
        ) return;

        if (
            e.includes(
                'Stream Errored (restart required)'
            )
        ) return;

        if (
            e.includes(
                'statusCode: 515'
            )
        ) return;

        if (
            e.includes(
                'statusCode: 503'
            )
        ) return;


        console.log(
            'Caught exception:',
            err
        );

    }
);


export default router;
