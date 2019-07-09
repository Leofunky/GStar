import * as RxDB from "rxdb";
import { RxDatabase } from "rxdb";
import logger from "../utils/logger";
import { extendRxDB } from "./dbExtension";
import repoSchema from "./schemas/repoSchema";
import authorSchema from "./schemas/authorSchema";
import meSchema from "./schemas/meSchema";
import tagSchema from "./schemas/tagSchema";
import categorySchema from "./schemas/categorySchema";
import languageSchema from "./schemas/languageSchema";
import settingSchema from "./schemas/settingSchema";

declare var window;

RxDB.plugin(require("pouchdb-adapter-idb"));

const collections: any[] = [
    {
        name: "repos",
        schema: repoSchema as any
    },
    {
        name: "authors",
        schema: authorSchema,
        sync: false
    },
    {
        name: "me",
        schema: meSchema,
        sync: false
    },
    {
        name: "tags",
        schema: tagSchema as any,
        methods: {
            countRepos() {
                return this.repos.length;
            }
        },
        sync: false
    },
    {
        name: "categories",
        schema: categorySchema,
        methods: {
            countRepos() {
                return this.repos.length;
            }
        },
        sync: false
    },
    {
        name: "languages",
        schema: languageSchema,
        methods: {
            countRepos() {
                return this.repos.length;
            }
        }
    },
    {
        name: "settings",
        schema: settingSchema,
        sync: false
    }
];

let dbPromise: Promise<RxDatabase>;

const _create = async function(dbName) {
    logger.log(`DatabaseService: creating database ${dbName}..`);

    const db = await RxDB.create({
        name: dbName,
        adapter: "idb",
        password: ""
    });

    logger.log("DatabaseService: created database");
    // debug
    if (window._DEBUG_) {
        window.sc_db = db;
        // db.$.subscribe(changeEvent => Logger(changeEvent))
    }

    // create collections
    logger.log("DatabaseService: create collections");

    const cols = await Promise.all(collections.map(colData => db.collection(colData)));

    cols.forEach(col => {
        extendRxDB(col);
    });

    // hooks
    logger.log("DatabaseService: add hooks");

    // TODO

    // db.collections.repos.preInsert(function(docObj) {
    //     const color = docObj.color;
    //     return db.collections.heroes.findOne({color}).exec().then(has => {
    //         if (has != null) {
    //             alert('another hero already has the color ' + color);
    //             throw new Error('color already there')
    //         }
    //         return db
    //     })
    // })

    // sync
    // Logger('DatabaseService: sync')

    // collections.filter(col => col.sync).map(col => col.name).map(colName => db[colName].sync(syncURL + colName + '/'))

    return db;
};

export function get(dbName) {
    if (!dbPromise) {
        dbPromise = _create(dbName);
    }
    return dbPromise;
}
