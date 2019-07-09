import GithubClient from "./githubClient";
import * as EVENTS from "../../shared/events";
import * as CONSTANTS from "../constants";
import { ipcRenderer } from "electron";
import DBHandler from "../rxdb/dbHandler";
import dbName from "./dbName";
import { ICredentialsState } from "../interface/IAccount";
import IProfile from "../interface/IProfile";

export default class Authentication {
    static getLocalCredentials(): Promise<ICredentialsState> {
        return new Promise((resolve, reject) => {
            let username = localStorage.getItem(CONSTANTS.LOCAL_STORAGE_USERNAME_KEY);
            if (!username) {
                reject(new Error("No local login record found"));
            } else {
                ipcRenderer.send(EVENTS.GET_LOCAL_CREDENTIALS, username);
                ipcRenderer.once(EVENTS.GET_LOCAL_CREDENTIALS_REPLY, (_event, arg) => {
                    if (!arg) {
                        reject(new Error("Retrieve password from keychain failed"));
                    }
                    let credentials = JSON.parse(arg);
                    if (credentials.username && credentials.password) {
                        resolve(credentials);
                    } else {
                        reject(new Error("Retrieve password from keychain failed"));
                    }
                });
            }
        });
    }

    static saveCredentialsToSystem(credentials): Promise<ICredentialsState> {
        return new Promise((resolve, reject) => {
            localStorage.setItem(CONSTANTS.LOCAL_STORAGE_USERNAME_KEY, credentials.username);
            ipcRenderer.send(EVENTS.SAVE_CREDENTIALS_TO_SYSTEM, JSON.stringify(credentials));
            ipcRenderer.once(EVENTS.SAVE_CREDENTIALS_TO_SYSTEM_REPLY, (_event, result) => {
                if (result) {
                    resolve(credentials);
                } else {
                    reject(new Error("Save credentials to keychain failed"));
                }
            });
        });
    }

    static saveProfileToLocal(profile): Promise<IProfile> {
        return new Promise(resolve => {
            // localStorage.setItem(CONSTANTS.LOCAL_STORAGE_USER_PROFILE, JSON.stringify(profile))
            resolve(profile);
        });
    }

    static deleteLocalCredentials(): Promise<string> {
        return new Promise((resolve, reject) => {
            let username = localStorage.getItem(CONSTANTS.LOCAL_STORAGE_USERNAME_KEY);
            if (!username) {
                resolve("");
            } else {
                ipcRenderer.send(EVENTS.DELETE_LOCAL_CREDENTIALS, username);
                ipcRenderer.once(EVENTS.DELETE_LOCAL_CREDENTIALS_REPLY, (_event, result) => {
                    result
                        ? resolve(username || "")
                        : reject(new Error("Delete credentials from keychain failed"));
                });
            }
        });
    }

    static signInApp(credentials): Promise<IProfile> {
        let githubClient = new GithubClient(credentials);
        return githubClient
            .getMyProfile()
            .then(profile => {
                // success stuff
                if (profile && profile.login === credentials.username) {
                    // save credentials to windows credentials
                    let p1 = Authentication.saveCredentialsToSystem(credentials);
                    let p2 = Authentication.saveProfileToLocal(profile);
                    // init rxdb and save profile to db
                    const dbHandler = new DBHandler(dbName(credentials.username));
                    let p3 = dbHandler.initDB().then(() => dbHandler.upsertProfile(profile));

                    // show main window now and close login window
                    setTimeout(() => {
                        ipcRenderer.send(
                            EVENTS.SHOW_MAIN_WIN_AND_CLOSE_LOGIN_WIN,
                            JSON.stringify(credentials)
                        );
                    }, 3000);

                    return Promise.all([p1, p2, p3]).then(() => profile);
                } else {
                    return new Error("The token you provided does not match this account");
                }
            })
            .catch(error => {
                console.log(error);
                throw error;
            });
    }

    static signOutApp() {
        localStorage.removeItem(CONSTANTS.LOCAL_STORAGE_USERNAME_KEY);
        return Authentication.deleteLocalCredentials();
    }
}
