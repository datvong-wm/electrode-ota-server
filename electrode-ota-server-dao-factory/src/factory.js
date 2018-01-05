import { alreadyExistsMsg } from "electrode-ota-server-errors";
import { promiseMap, reducer, toJSON } from "electrode-ota-server-util";
import _ from "lodash";

const isEmpty = arr => {
  if (arr == null) return true;
  if (arr.length === 0) return true;
  return false;
};
const isNotEmpty = arr => !isEmpty(arr);

const apply = (target, source) => {
  if (!source) {
    return target;
  }
  for (const key of Object.keys(target)) {
    if (key == "_validators") continue;
    if (source.hasOwnProperty(key)) {
      const newValue = source[key];
      target[key] = newValue;
    }
  }
  return target;
};

const ACCESSKEY = [
  "name",
  "id",
  "expires",
  "description",
  "lastAccess",
  "createdTime",
  "createdBy",
  "friendlyName"
];

// Set any property that's undefined or not exist to null
const objDefaultNull = (obj, keys) => {
  for (const key of keys) {
    if (obj[key] === void 0) {
      obj[key] = null;
    }
  }
  return obj;
};

const historySort = history =>
  history &&
  history.sort((a, b) => b.created_.getTime() - a.created_.getTime());

/**
 * DAO Factory methods to save/update/delete DAOs to/from DataStore.
 *
 * Models
 * - App
 * - Deployment
 * - Package
 * - User
 *
 * Model functions
 * - deleteAsync()
 * - findOneAsync(query, options)
 * - findAsync(query, options)
 * - saveAsync(options)
 * - updateAsync(updates, options)
 */
export default class DaoFactory {
  constructor({ driver, logger }) {
    this.driver = driver;
    this.logger = logger;
  }
  async init() {
    return this.driver.init();
  }

  async createUser({ email, name, accessKeys, linkedProviders = [] }) {
    const user = new this.driver.User({
      email,
      name,
      accessKeys,
      linkedProviders
    });
    const exists = await user.saveAsync();
    alreadyExistsMsg(exists, `User already exists ${email}`);

    return user;
  }

  userById(id) {
    return this.driver.User.findOneAsync({ id });
  }

  userByAccessKey(accessKeys) {
    return this.driver.User.findOneAsync({ accessKeys });
  }

  async userByEmail(email) {
    return this.driver.User.findOneAsync({ email });
  }

  async updateUser(currentEmail, update) {
    const user = await this.userByEmail(currentEmail);
    apply(user, update);
    await user.saveAsync();
    const js = toJSON(user);

    _.each(js.accessKeys, (value, key) => {
      objDefaultNull(js.accessKeys[key], ACCESSKEY);
    });
    return js;
  }

  /**
   * Create a new App
   *
   * @param {object} values
   *  name: name of app, string
   *  deployments: list of deployments
   *  collaborators: map of collaborators
   *
   */
  async createApp({ name, deployments = {}, collaborators }) {
    const app = new this.driver.App({ name, collaborators });
    const savedApp = await app.saveAsync();

    const deps = Object.keys(deployments);
    if (isNotEmpty(deps)) {
      for (const name of deps) {
        await this.addDeployment(app.id, name, deployments[name]);
      }
    }
    savedApp.deployments = deps;
    return savedApp;
  }

  /**
   * Remove an app
   * @param {*} appId
   */
  async removeApp(appId) {
    const app = await this.appById(appId);
    if (isEmpty(app)) return;
    return app.deleteAsync();
  }

  /**
   * Update an app
   * @param {*} id
   * @param {*} param1
   */
  async updateApp(id, { name, collaborators }) {
    const app = await this.appById(id);
    app.name = name;
    app.collaborators = collaborators;
    const resp = await app.saveAsync();
    return app;
  }

  /**
   * Get an app by id
   * @param {*} id
   */
  appById(id) {
    return this.driver.App.findOneAsync({ id });
  }

  /**
   * Get all apps for a given email
   *
   * @param {*} email
   */
  appsForCollaborator(email) {
    return this.driver.App.findAsync({ collaborators: email });
  }

  appForCollaborator(email, appName) {
    return this.driver.App.findOneAsync({
      collaborators: email,
      name: appName
    });
  }

  /**
   * Add a deployment
   * @param {*} app
   * @param {*} name
   * @param {*} param2
   */
  addDeployment(app, name, { key }) {
    const deployment = new this.driver.Deployment({ name, key, AppId: app });
    return deployment.saveAsync();
  }

  /**
   * Remove a deployment
   *
   * @param {*} appId
   * @param {*} deploymentName
   */
  async removeDeployment(appId, deploymentName) {
    const deployment = await this.driver.Deployment.findOneAsync({
      AppId: appId,
      name: deploymentName
    });
    return deployment.deleteAsync();
  }

  /**
   * Rename a deployment
   *
   * @param {*} appId
   * @param {*} oldName
   * @param {*} newName
   */
  async renameDeployment(appId, oldName, newName) {
    const deployment = await this.driver.Deployment.findOneAsync({
      AppId: appId,
      name: oldName
    });
    deployment.name = newName;
    return deployment.saveAsync();
  }

  /**
   * Get deployment by key
   *
   * @param {*} deploymentKey
   */
  async deploymentForKey(deploymentKey) {
    let dep = await this.driver.Deployment.findOneAsync({ key: deploymentKey });
    if (dep && isNotEmpty(dep.history_)) {
      dep = toJSON(dep);
      dep.package = await this.driver.Package.findOneAsync({
        id_: dep.history_[0]
      });
      return dep;
    }
    return dep;
  }

  /**
   * Get all deployments for an app
   *
   * @param {*} appId
   * @param {*} deployments
   */
  async deploymentsByApp(appId, deployments) {
    if (isEmpty(deployments)) {
      return [];
    }
    const deps = await this.driver.Deployment.findAsync({
      appId,
      name: deployments
    });
    if (isEmpty(deps)) return [];
    return promiseMap(
      reducer(deps, (ret, d) => (ret[d.name] = this.deploymentForKey(d.key)))
    );
  }

  /**
   * Get a deployment
   *
   * @param {*} appId
   * @param {*} deployment
   */
  async deploymentByApp(appId, deployment) {
    const d = await this.driver.Deployment.findOneAsync({
      appId,
      name: deployment
    });
    if (!d) return;
    return this.deploymentForKey(d.key);
  }

  async _historyForDeployment(key) {
    const res = await this.driver.Deployment.findOneAsync({ key });
    return res.history_;
  }

  /**
   * Add a package to a deployment
   *
   * @param {*} deploymentKey
   * @param {*} value
   */
  async addPackage(deploymentKey, value) {
    const deployment = await this.driver.Deployment.findOneAsync({
      key: deploymentKey
    });
    if (isEmpty(deployment)) {
      throw new Error(`Can not find deployment ${deploymentKey}.`);
    }
    const pkg = new this.driver.Package(value);
    await pkg.saveAsync();
    await deployment.associateAsync(pkg);

    return pkg;
  }

  /**
   * Update a package of a deployment
   *
   * @param {*} deploymentKey
   * @param {*} pkg
   * @param {*} label
   */
  async updatePackage(deploymentKey, pkg, label) {
    const history_ = await this._historyForDeployment(deploymentKey);
    if (isEmpty(history_)) {
      throw new Error(
        `Can not update a package without history, probably means things have gone awry.`
      );
    }
    let rpkg;

    if (label) {
      rpkg = await this.driver.Package.findOneAsync({ id_: history_, label });
    } else {
      rpkg = await this.driver.Package.findOneAsync({ id_: history_ });
    }
    await rpkg.updateAsync(pkg);
    return rpkg;
  }

  /**
   * Get history of a deployment.
   * @param {*} appId
   * @param {*} deploymentName
   */
  async history(appId, deploymentName) {
    const deployment = await this.deploymentByApp(appId, deploymentName);
    if (!deployment || !deployment.history_) {
      return [];
    }
    const pkgs = await this.driver.Package.findAsync({
      id_: deployment.history_
    });

    return historySort(pkgs);
  }

  /**
   * Get history of a deployment by id(s)
   *
   * @param {*} historyIds
   */
  async historyByIds(historyIds) {
    if (historyIds == null || historyIds.length == 0) {
      return [];
    }
    const pkgs = await this.driver.Package.findAsync({ id_: historyIds });
    return historySort(pkgs);
  }

  /**
   * Clear the history of a deployment
   *
   * @param {*} appId
   * @param {*} deploymentName
   */
  async clearHistory(appId, deploymentName) {
    const deployment = await this.deploymentByApp(appId, deploymentName);
    if (deployment && isNotEmpty(deployment.history_)) {
      return this.driver.Package.delete({ id_: deployment.history_ });
    }
  }

  /**
   * Get history of a deployment by label
   *
   * @param {*} appId
   * @param {*} deploymentName
   * @param {*} label
   */
  async historyLabel(appId, deploymentName, label) {
    const deployment = await this.deploymentByApp(appId, deploymentName);
    if (!deployment || isEmpty(deployment.history_)) {
      return;
    }
    const pkg = await this.driver.Package.findOneAsync({
      id_: deployment.history_,
      label: label
    });
    return pkg;
  }

  /**
   * Get a package by Id
   */
  async packageById(pkgId) {
    if (!pkgId) return;
    return this.driver.Package.findOneAsync({ id_: pkgId });
  }

  /**
   * Upload a package
   *
   */
  async upload(packageHash, content) {
    if (!Buffer.isBuffer(content)) {
      content = Buffer.from(content, "utf8");
    }
    const pkg = new this.driver.PackageContent({ packageHash, content });
    const exists = await pkg.saveAsync();
    return exists;
  }

  /**
   * Download a package
   *
   */
  async download(packageHash) {
    const pkg = await this.driver.PackageContent.findOneAsync({ packageHash });
    if (pkg != null) {
      return pkg.content;
    }
  }

  /**
   * Get metrics for a deployment
   *
   */
  metrics(deploymentKey) {
    return this.driver.Metric.findAsync({ deploymentKey });
  }

  /**
   * Record download or deploy metric
   *
   * @param {object} values
   *      appVersion text,
   *      deploymentKey text,
   *      clientUniqueId text,
   *      label text
   *      status text,
   *      previousLabelOrAppVersion text,
   *      previousDeploymentKey text,
   *
   * "appVersion": "1.0.0",
   * "deploymentKey": "5UfjnOxv1FnCJ_DwPqMWQYSVlp0H4yecGHaB-",
   * "clientUniqueId": "fe231438a4f62c70",
   * "label": "v1",
   * "status": "DeploymentSucceeded",
   * "previousLabelOrAppVersion": "1.0.0",
   * "previousDeploymentKey": "5UfjnOxv1FnCJ_DwPqMWQYSVlp0H4yecGHaB-"
   */
  async insertMetric(values) {
    const metric = new this.driver.Metric(values);
    return metric.saveAsync();
  }

  clientRatio(clientUniqueId, packageHash) {
    return this.driver.ClientRatio.findOneAsync({
      clientUniqueId,
      packageHash
    });
  }

  /**
   * Tracks whether we updated the client or not last time.
   *
   * @param {string} clientUniqueId : Client Device Unique ID
   * @param {string} packageHash : Package hash to update to.
   * @param {float} ratio : Deployment ratio
   * @param {bool} updated : flag indicating if client was/was not updated.
   */
  insertClientRatio(clientUniqueId, packageHash, ratio, updated) {
    const clientRatio = new this.driver.ClientRatio({
      clientUniqueId,
      packageHash,
      ratio,
      updated
    });
    return clientRatio.saveAsync();
  }
}
