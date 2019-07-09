import { observable, action, toJS, computed } from "mobx";
import moment from "moment";
import ILanguage from "../interface/ILanguage";
import ICategory from "../interface/ICategory";
import GroupType from "../enum/GroupType";
import SearchType from "../enum/SearchType";
import OrderBy from "../enum/OrderBy";
import {
    IGroupConditionState,
    ISearchConditionState,
    IOrderConditionState,
    IFilterConditionState
} from "../interface/IConditional";
import GlobalStore from "../store/GlobalStore";
import DBHandler from "../rxdb/dbHandler";
import logger from "../utils/logger";
import IRepo from "../interface/IRepo";
import GithubClient from "../utils/githubClient";
import ITag from "renderer/interface/ITag";
import IContributor from "renderer/interface/IContributor";

export default class MainStore {
    private globalStore: GlobalStore;

    constructor(globalStore: GlobalStore) {
        this.globalStore = globalStore;
    }

    private getDbHandler = () => {
        return this.globalStore.getDb().then(db => {
            return new DBHandler(db);
        });
    };

    public startup = () => {
        return this.globalStore.restore().then(() => {
            this.updateCategoryList();
            this.updateLanguageList();
            this.updateRepoList();
            return this.fetchRemoteRepos();
        });
    };

    /**
     * Fetch status
     */
    @observable fetching: boolean = false;

    /**
     * Languages
     */
    @observable languages: ILanguage[] = [];

    @action
    updateLanguageList = () => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.initDB())
            .then(dbHandler => dbHandler.getLanguages())
            .then(languages => {
                this.languages = languages;
                return languages;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
            });
    };

    /**
     * Categories
     */
    @observable categories: ICategory[] = [];

    @action
    updateCategoryList = () => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.initDB())
            .then(dbHandler => dbHandler.getCategories())
            .then(categories => {
                this.categories = categories;
                return categories;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
            });
    };

    @action
    addNewCategory = (name: string) => {
        const { categories } = this;
        return this.getDbHandler()
            .then(dbHandler => dbHandler.initDB())
            .then(dbHandler => dbHandler.upsertCategory(name))
            .then(categoryDoc => {
                this.categories = new Array().concat(categories).concat(categoryDoc.toJSON());

                return categoryDoc;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    @action
    delCategory = (id: number) => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.initDB())
            .then(dbHandler => dbHandler.deleteCategory(id))
            .then(() => {
                this.updateCategoryList();
                return true;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
            });
    };

    /**
     * Search condition
     */
    @observable search: ISearchConditionState = { key: "", field: SearchType.SEARCH_FIELD_ALL };

    @action
    onUpdateSearchCondition = (key: string, field: SearchType) => {
        const { search, repos } = this;
        if (key !== search.key || field !== search.field) {
            this.search = {
                key,
                field
            };
            return this.updateRepoList();
        }
        return Promise.resolve(toJS(repos));
    };

    /**
     * Order condition
     */
    @observable order: IOrderConditionState = { by: OrderBy.ORDER_BY_DEFAULT, desc: true };

    @action
    onUpdateOrderCondition = (desc: boolean, by: OrderBy) => {
        logger.log(`Sort: ${by} ${desc ? "DESC" : "ASC"}`);
        const { order, repos } = this;
        if (order.desc !== desc || order.by !== by) {
            this.order = {
                desc,
                by
            };
            return this.updateRepoList();
        }
        return Promise.resolve(toJS(repos));
    };

    /**
     * filter condition
     */
    @observable filter: IFilterConditionState = { hasFlag: false, hasNote: false, unread: false };

    @action
    onUpdateFilterCondition = (newFilter: IFilterConditionState) => {
        logger.log(`Filter: ${newFilter}`);
        const { filter, repos } = this;
        if (
            filter.hasFlag !== newFilter.hasFlag ||
            filter.hasNote !== newFilter.hasNote ||
            filter.unread !== newFilter.unread
        ) {
            this.filter = newFilter;
            return this.updateRepoList();
        }
        return Promise.resolve(toJS(repos));
    };

    /**
     * Group condition
     */
    @observable
    group: IGroupConditionState = {
        id: GroupType.GROUP_TYPE_ALL,
        type: GroupType.GROUP_TYPE_ALL
    };

    @observable openNavMenus: GroupType[] = [GroupType.GROUP_TYPE_ALL];

    @action
    onClickNavMenuItem = ({ key, keyPath }) => {
        if (this.fetching) {
            return; // not available when fetching data
        }
        let group;
        if (keyPath.length === 1) {
            group = {
                id: key,
                type: key
            };
        } else {
            group = {
                id: key,
                type: keyPath[1]
            };
        }
        if (group.id === this.group.id) {
            return;
        }
        this.group = group;
        this.updateRepoList();
    };

    @action
    onToggleNavMenus = (openKeys: GroupType[]) => {
        const { openNavMenus } = this;
        const latestOpenKey = openKeys.find(key => !(openNavMenus.indexOf(key) > -1));

        let nextOpenKeys: GroupType[] = [];
        if (latestOpenKey) {
            nextOpenKeys = new Array().concat(latestOpenKey);
        }
        this.openNavMenus = nextOpenKeys;
    };

    /**
     * Repos
     */
    @observable repos: IRepo[] = [];

    @observable reposMap: { [key: string]: IRepo } = {};

    @action
    updateRepoList = () => {
        logger.log("Update repo list");
        const { group, search, order, filter } = this;
        const conditions = {
            group,
            search,
            order,
            filter
        };

        return this.getDbHandler()
            .then(dbHandler => dbHandler.getRepos(conditions))
            .then(repos => {
                // for easily replace one specified item of list
                // we need convert the array to key-value pairs
                let keyedRepos: { [key: string]: IRepo } = {};
                repos.forEach(repo => {
                    keyedRepos[repo.id] = repo;
                });

                this.repos = repos;
                this.reposMap = keyedRepos;

                const total = repos.length;
                const maxPage = Math.ceil(total / this.pageSize);
                this.total = total;
                if (this.page > maxPage) {
                    this.page = 1;
                }

                return repos;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                // throw error;
            });
    };

    @action
    fetchRemoteRepos = () => {
        if (this.fetching) {
            return Promise.reject(false);
        }
        const client = new GithubClient(this.globalStore.credentials);
        this.fetching = true;
        return client
            .getStarredRepos()
            .then(ret => ret.data)
            .then(repos => {
                return this.getDbHandler()
                    .then(dbHandler => {
                        return Promise.all([
                            dbHandler.upsertRepos(repos),
                            dbHandler.upsertOwners(repos),
                            dbHandler.upsertLanguages(repos),
                            dbHandler.recordReposCount(repos.length)
                        ]);
                    })
                    .then(ret => {
                        this.updateLanguageList();
                        this.updateRepoList();

                        // return repo count change
                        return ret[3];
                    });
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                this.updateRepoList();
                throw error;
            })
            .finally(() => {
                this.fetching = false;
            });
    };

    /**
     * Selected repo
     */
    @observable selectedRepo: IRepo;

    @action
    onSelectRepo = (id: number) => {
        logger.log(`Select repo: ${id}`);
        const { reposMap, selectedRepo } = this;
        if (selectedRepo && selectedRepo.id === id) {
            return;
        }
        const newRepo = reposMap[id];
        this.selectedRepo = newRepo;
        this.selectRepoTags = [];
        this.selectRepoCategories = [];
        this.selectRepoContributors = [];

        if (newRepo && !newRepo._contributors) {
            logger.log(`Fetch and get repo contributors for selected repo ${newRepo.id}`);
            this.onFetchRepoContributors(newRepo);
            this.onGetSelectRepoContributors(newRepo.id);
            this.onGetTagsForRepo(newRepo.id);
            this.onGetSelectRepoCategories(newRepo.id);
        }
    };

    @action
    onRateRepo = (id: number, score: number) => {
        logger.log(`Rate repo: ${id}`);
        const updateObj = {
            id,
            score
        };

        return this.getDbHandler()
            .then(dbHandler => dbHandler.updateRepo(updateObj))
            .then(repo => {
                // also replace new repo into repos list
                this.replaceOneRepoInList(repo);

                return repo;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                // throw error;
            });
    };

    /**
     * Star StarCabinet
     */
    onStarStarCabinet = () => {
        const client = new GithubClient(this.globalStore.credentials);
        return client
            .starStarCabinet()
            .then(ret => {
                return ret;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw new Error(error);
            });
    };

    /**
     * Replace one repo in list
     */
    @action
    replaceOneRepoInList = (repo: IRepo) => {
        let { repos, reposMap } = this;
        reposMap[repo.id] = repo;
        repos = repos.map(item => reposMap[item.id]);

        this.repos = Array.from(repos);
        this.reposMap = Object.assign({}, reposMap);
    };

    /**
     * Update select repo(flag, read status, note...)
     */
    @action
    onUpdateSelectedRepo = (id: number, properties: { [key: string]: any }) => {
        const { selectedRepo } = this;
        if (!selectedRepo || id !== selectedRepo.id) {
            return Promise.reject(false);
        }

        properties.id = id;

        return this.getDbHandler()
            .then(dbHandler => dbHandler.updateRepo(properties))
            .then(repo => {
                // also replace the repo in repos list
                repo._hotChange = Object.keys(properties); // mark the repo that its readme etc.. has fetched, do not fetch again
                this.replaceOneRepoInList(repo);

                this.selectedRepo = Object.assign({}, selectedRepo, repo);

                return repo;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    /**
     * Update repo categories
     */
    @action
    onUpdateRepoCategories = (id: number, catIds: number[]) => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.updateRepoCategories(id, catIds))
            .then(repo => {
                // also replace the repo in repos list
                this.replaceOneRepoInList(repo);

                // if it has same id with selectedRepo, also replace selectedRepo
                this.onUpdateSelectedRepo(id, {
                    rxChange: Math.floor(moment.now().valueOf() / 1000)
                });

                if (this.selectedRepo.id === id) {
                    this.selectRepoCategories = repo._categories;
                }

                // update all categories list, for updating the nav category node
                this.updateCategoryList();

                return repo;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    /**
     * Update repo contributors
     */
    @action
    onUpdateRepoContributors = (id: number, contributors) => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.upsertContributors(id, contributors))
            .then(_contributors => {
                // also replace the repo in repos list
                let repo = this.reposMap[id];
                if (repo) {
                    repo._contributors = _contributors;
                    repo._hotChange = ["contributors"];
                    this.replaceOneRepoInList(repo);
                    if (repo.id === this.selectedRepo.id) {
                        this.selectRepoContributors = _contributors;
                    }
                }

                // if it has same id with selectedRepo, also replace selectedRepo
                this.onUpdateSelectedRepo(id, {
                    rxChange: Math.floor(moment.now().valueOf() / 1000)
                });

                return repo;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    @action
    onAddTagForRepo = (id: number, tagName: string) => {
        logger.log(`Adding tag: ${tagName} for repo: ${id}`);
        return this.getDbHandler()
            .then(dbHandler => dbHandler.addRepoTag(id, tagName))
            .then(repo => {
                // also replace the repo in repos list
                this.replaceOneRepoInList(repo);

                if (this.selectedRepo.id === id) {
                    this.selectRepoTags = repo._tags;
                }

                // if it has same id with selectedRepo, also replace selectedRepo
                this.onUpdateSelectedRepo(id, {
                    rxChange: Math.floor(moment.now().valueOf() / 1000)
                });

                return repo;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    @action
    onRemoveTagForRepo = (id: number, tagName: string) => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.removeRepoTag(id, tagName))
            .then(repo => {
                // also replace the repo in repos list
                this.replaceOneRepoInList(repo);

                if (this.selectedRepo.id === id) {
                    this.selectRepoTags = repo._tags;
                }

                // if it has same id with selectedRepo, also replace selectedRepo
                this.onUpdateSelectedRepo(id, {
                    rxChange: Math.floor(moment.now().valueOf() / 1000)
                });

                return repo;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    @action
    onGetTagsForRepo = (id: number) => {
        return this.getDbHandler()
            .then(dbHandler => dbHandler.getRepoTags(id))
            .then(tags => {
                // also add tags to the repo and replace the repo in repos list
                let repo = this.reposMap[id];
                if (repo) {
                    repo._tags = tags;
                    this.replaceOneRepoInList(repo);
                    if (this.selectedRepo.id === repo.id) {
                        this.selectRepoTags = tags;
                    }
                }

                return tags;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    @action
    onFetchRepoReadMe = (repo: IRepo) => {
        const client = new GithubClient(this.globalStore.credentials);
        return client
            .getRepoReadMe(repo.fullName, repo.defaultBranch)
            .then(readme => {
                if (repo.readme !== readme) {
                    this.onUpdateSelectedRepo(repo.id, { readme });
                }

                return readme;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    @action
    onFetchRepoContributors = (repo: IRepo) => {
        const client = new GithubClient(this.globalStore.credentials);
        return client
            .getRepoContributors(repo.fullName)
            .then(contributors => {
                // save contributors to db
                this.onUpdateRepoContributors(repo.id, contributors);

                return contributors;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    /**
     * Get contributors for selected repo
     */
    @action
    onGetSelectRepoContributors = (id: number) => {
        const { selectedRepo } = this;
        if (!selectedRepo || selectedRepo.id !== id) {
            return Promise.reject(false);
        }
        return this.getDbHandler()
            .then(dbHandler => dbHandler.getRepoContributors(id))
            .then(contributors => {
                // also add contributors to the repo and replace the repo in repos list
                let repo = this.reposMap[id];
                if (repo) {
                    repo._contributors = contributors;
                    repo._hotChange = ["contributors"];
                    this.replaceOneRepoInList(repo);

                    if (repo.id === this.selectedRepo.id) {
                        this.selectRepoContributors = contributors;
                    }
                }

                // if it has same id with selectedRepo, also replace selectedRepo
                this.onUpdateSelectedRepo(id, {
                    rxChange: Math.floor(moment.now().valueOf() / 1000)
                });

                return contributors;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    /**
     * Get categories for selected repo
     */
    @action
    onGetSelectRepoCategories = (id: number) => {
        const { selectedRepo } = this;
        if (!selectedRepo || selectedRepo.id !== id) {
            return Promise.reject(false);
        }
        return this.getDbHandler()
            .then(dbHandler => dbHandler.getRepoCategories(id))
            .then(categories => {
                // also add categories to the repo and replace the repo in repos list
                let repo = this.reposMap[id];
                if (repo) {
                    repo._categories = categories;
                    this.replaceOneRepoInList(repo);

                    if (this.selectedRepo.id === repo.id) {
                        this.selectRepoCategories = categories;
                    }
                }

                return categories;
            })
            .catch(error => {
                logger.log(error.message || error.toString());
                throw error;
            });
    };

    /**
     * Ext properties for selected repo
     */
    @observable selectRepoTags: ITag[] = [];
    @observable selectRepoContributors: IContributor[] = [];
    @observable selectRepoCategories: ICategory[] = [];

    /**
     * Pagination
     */
    @observable page: number = 1;
    @observable pageSize: number = 20;
    @observable total: number = 0;

    @computed
    get pageRepos() {
        const { page, pageSize, repos } = this;
        const list = repos.slice((page - 1) * pageSize, page * pageSize);
        return list;
    }

    @action
    onPageChange = (page: number) => {
        logger.log(`Change page to: ${page}`);
        this.page = page;
    };

    @action
    resetPagination = () => {
        this.page = 1;
        this.pageSize = 20;
    };
}
