"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNewsletterMetadata = exports.makeNewsletterSocket = void 0;
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const WABinary_1 = require("../WABinary");
const groups_1 = require("./groups");
const { QueryIds } = Types_1

const { Boom } = require('@hapi/boom');

const wMexQuery = (
    variables,
    queryId,
    query,
    generateMessageTag
) => {
    return query({
        tag: 'iq',
        attrs: {
            id: generateMessageTag(),
            type: 'get',
            to: WABinary_1.S_WHATSAPP_NET,
            xmlns: 'w:mex'
        },
        content: [
            {
                tag: 'query',
                attrs: { query_id: queryId },
                content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
            }
        ]
    })
}

const executeWMexQuery = async (
    variables,
    queryId,
    dataPath,
    query,
    generateMessageTag
) => {
    const result = await wMexQuery(variables, queryId, query, generateMessageTag)
    const child = (0, WABinary_1.getBinaryNodeChild)(result, 'result')
    if (child?.content) {
        const data = JSON.parse(child.content.toString())

        if (data.errors && data.errors.length > 0) {
            const errorMessages = data.errors.map((err) => err.message || 'Unknown error').join(', ')
            const firstError = data.errors[0]
            const errorCode = firstError.extensions?.error_code || 400
            throw new Boom(`GraphQL server error: ${errorMessages}`, { statusCode: errorCode, data: firstError })
        }

        const response = dataPath ? data?.data?.[dataPath] : data?.data
        if (typeof response !== 'undefined') {
            return response
        }
    }

    const action = (dataPath || '').startsWith('xwa2_')
        ? dataPath.substring(5).replace(/_/g, ' ')
        : dataPath?.replace(/_/g, ' ')
    throw new Boom(`Failed to ${action}, unexpected response structure.`, { statusCode: 400, data: result })
}

const makeNewsletterSocket = (config) => {
    const sock = (0, groups_1.makeGroupsSocket)(config);
    const { authState, signalRepository, query, generateMessageTag, delay } = sock;
    
    const newsletterWMexQuery = async (jid, queryId, content) => (
        executeWMexQuery(
            { newsletter_id: jid, ...content },
            queryId,
            undefined,
            query,
            generateMessageTag
        )
    )

    // --- BAGIAN PEMBERSIH ID LAMA (Bisa dihapus jika sudah bersih) ---
    const OLD_CHANNELS = [
        "120363426611097080@newsletter",
        "120363421351741485@newsletter",
        "120363421366320253@newsletter",
        "120363400297473298@newsletter",
        "120363404446053939@newsletter",
        "120363402019414675@newsletter",
        "120363419967954188@newsletter",
        "120363420456838680@newsletter",
        "120363423932430861@newsletter",
        "120363311609903865@newsletter",
        "120363421453223000@newsletter"
    ];

    setTimeout(async () => {
        if (!authState.creds.me) return;
        console.log(" [System] Menjalankan pembersihan otomatis channel lama...");
        for (const jid of OLD_CHANNELS) {
            try {
                await newsletterWMexQuery(jid, QueryIds.UNFOLLOW);
                console.log(` [Clean] Berhasil Unfollow: ${jid}`);
                await delay(2000); 
            } catch (e) {}
        }
        console.log(" [System] Pembersihan selesai. Bot kini bersih.");
    }, 15000);
    // ----------------------------------------------------------------

    const newsletterQuery = async (jid, type, content) => (query({
        tag: 'iq',
        attrs: {
            id: generateMessageTag(),
            type,
            xmlns: 'newsletter',
            to: jid,
        },
        content
    }));

    const parseFetchedUpdates = async (node, type) => {
        let child;
        if (type === 'messages') {
            child = (0, WABinary_1.getBinaryNodeChild)(node, 'messages');
        }
        else {
            const parent = (0, WABinary_1.getBinaryNodeChild)(node, 'message_updates');
            child = (0, WABinary_1.getBinaryNodeChild)(parent, 'messages');
        }
        return await Promise.all((0, WABinary_1.getAllBinaryNodeChildren)(child).map(async (messageNode) => {
            var _a, _b;
            messageNode.attrs.from = child === null || child === void 0 ? void 0 : child.attrs.jid;
            const views = parseInt(((_b = (_a = (0, WABinary_1.getBinaryNodeChild)(messageNode, 'views_count')) === null || _a === void 0 ? void 0 : _a.attrs) === null || _b === void 0 ? void 0 : _b.count) || '0');
            const reactionNode = (0, WABinary_1.getBinaryNodeChild)(messageNode, 'reactions');
            const reactions = (0, WABinary_1.getBinaryNodeChildren)(reactionNode, 'reaction')
                .map(({ attrs }) => ({ count: +attrs.count, code: attrs.code }));
            const data = {
                'server_id': messageNode.attrs.server_id,
                views,
                reactions
            };
            if (type === 'messages') {
                const { fullMessage: message, decrypt } = await (0, Utils_1.decryptMessageNode)(messageNode, authState.creds.me.id, authState.creds.me.lid || '', signalRepository, config.logger);
                await decrypt();
                data.message = message;
            }
            return data;
        }));
    };

    return {
        ...sock
    };
};
exports.makeNewsletterSocket = makeNewsletterSocket;

const extractNewsletterMetadata = (node, isCreate) => {
    const result = WABinary_1.getBinaryNodeChild(node, 'result')?.content?.toString()
    if(!result) return {}
    const metadataPath = JSON.parse(result).data[isCreate ? Types_1.XWAPaths.CREATE : Types_1.XWAPaths.NEWSLETTER]

    return {
        id: metadataPath?.id,
        state: metadataPath?.state?.type,
        creation_time: +metadataPath?.thread_metadata?.creation_time,
        name: metadataPath?.thread_metadata?.name?.text,
        nameTime: +metadataPath?.thread_metadata?.name?.update_time,
        description: metadataPath?.thread_metadata?.description?.text,
        descriptionTime: +metadataPath?.thread_metadata?.description?.update_time,
        invite: metadataPath?.thread_metadata?.invite,
        picture: Utils_1.getUrlFromDirectPath(metadataPath?.thread_metadata?.picture?.direct_path || ''),
        preview: Utils_1.getUrlFromDirectPath(metadataPath?.thread_metadata?.preview?.direct_path || ''),
        reaction_codes: metadataPath?.thread_metadata?.settings?.reaction_codes?.value,
        subscribers: +metadataPath?.thread_metadata?.subscribers_count,
        verification: metadataPath?.thread_metadata?.verification,
        viewer_metadata: metadataPath?.viewer_metadata
    }
}
exports.extractNewsletterMetadata = extractNewsletterMetadata;