"use strict";

window.addEventListener("load", function() {

const stages = 5;

function buf2hex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

function hexToUint8(hexValue) {
  const length = (hexValue.length / 2) | 0;
  const uint8 = new Uint8Array(length);
  for (let i = 0; i < length; i++) uint8[i] = parseInt(hexValue.substr(i * 2, 2), 16);

  return uint8;
}

const disclaimerCheckboxes = [
    "understandsKeysCheckbox",
    "backedUpBaseKeyCheckbox",
    null,
    null,
];

let stage;

const prevStageBtn = document.getElementById("prevStageBtn");
const nextStageBtn = document.getElementById("nextStageBtn");

function disclaimerCheckboxChanged(checkboxStage, checked) {
    if (stage == checkboxStage) {
        nextStageBtn.disabled = !checked;
    }
}

for (let checkboxStage = 0; checkboxStage < disclaimerCheckboxes.length; checkboxStage++) {
    const name = disclaimerCheckboxes[checkboxStage];
    if (!name) {
        disclaimerCheckboxChanged(checkboxStage, false);
        continue;
    }
    const elem = document.getElementById(name);
    if (stage > checkboxStage) {
        elem.checked = true;
    }
    elem.addEventListener("change", () => disclaimerCheckboxChanged(checkboxStage, elem.checked));
    disclaimerCheckboxChanged(checkboxStage, elem.checked);
}

const basePrivateKeyInput = document.getElementById("basePrivateKeyInput");
const basePublicKeyOutput = document.getElementById("basePublicKeyOutput");

let basePrivateKey = null;
let basePublicKeyString = null;
function basePrivateKeyUpdated() {
    const keyString = basePrivateKeyInput.value;
    if (!/^[0-9a-fA-F]{64}$/.test(keyString)) {
        basePublicKeyOutput.value = "invalid base private key";
        basePublicKeyString = null;
        return;
    }
    localStorage.setItem("basePrivateKey", keyString);
    const key = hexToUint8(keyString);
    const publicKey = curve25519.scalarBasePointMul(key);
    const publicKeyString = buf2hex(publicKey);
    basePrivateKey = key;
    basePublicKeyString = publicKeyString;
    basePublicKeyOutput.value = publicKeyString;
}

if (localStorage.getItem("basePrivateKey")) {
    basePrivateKeyInput.value = localStorage.getItem("basePrivateKey");
}
basePrivateKeyUpdated();

basePrivateKeyInput.addEventListener("keydown", basePrivateKeyUpdated);
basePrivateKeyInput.addEventListener("keypress", basePrivateKeyUpdated);
basePrivateKeyInput.addEventListener("keyup", basePrivateKeyUpdated);
basePrivateKeyInput.addEventListener("change", basePrivateKeyUpdated);

const generateBaseKeyBtn = document.getElementById("generateBaseKeyBtn");
const backedUpBaseKeyCheckbox = document.getElementById("backedUpBaseKeyCheckbox");

generateBaseKeyBtn.addEventListener("click", function() {
    if (basePrivateKeyInput.value) {
        if (!confirm("You have already set a base private key. Are you sure you want to overwrite it?")) {
            return;
        }
    }
    backedUpBaseKeyCheckbox.checked = false;
    disclaimerCheckboxChanged(1, false);
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    basePrivateKeyInput.value = buf2hex(bytes);
    basePrivateKeyUpdated();
});

const minerUrlInput = document.getElementById("minerUrlInput");
const minerNameField = document.getElementById("minerNameField");
const minerMaxCharsField = document.getElementById("minerMaxCharsField");
const minerInfoElem = document.getElementById("minerInfo");
const demandElems = {
    "none": document.getElementById("minerDemandNone"),
};

function estimateCharsFromBits(bits) {
    return Math.floor(bits / 32);
}

function promiseTimeout(promise, ms){
  let timeout = new Promise((resolve, reject) => {
    setTimeout(() => {
      reject('Timed out in ' + ms + 'ms.');
    }, ms);
  });

  return Promise.race([
    promise,
    timeout
  ]);
}

let minerCheck = 0;
let minerInfo;
let minerUrlInUse = null;
let lastMinerUrl = "";
async function checkMinerUrl(fromStageUpdate) {
    let url = minerUrlInput.value;
    if (!url || url === lastMinerUrl && !fromStageUpdate) return;
    lastMinerUrl = url;
    disclaimerCheckboxChanged(2, false);
    minerCheck++;
    let ourMinerCheck = minerCheck;
    if (!/^https?:\/\//.test(url)) {
        url = "http://" + url;
    }
    try {
        const res = await promiseTimeout(fetch(url + "/v1/info", {redirect: "follow"}), 1000);
        if (minerCheck !== ourMinerCheck) return;
        if (res.status < 200 || res.status >= 300) {
            throw new Error("Bad status code: " + res.status);
        }

        const json = await promiseTimeout(res.json(), 500);
        if (json.error) {
            throw new Error("Miner returned error: " + json.error.toString());
        }
        if (minerCheck !== ourMinerCheck) return;
        if (!json["name"] || !json["demand"] || !json["maxBits"] ||
                typeof json.name !== "string" || typeof json.demand !== "string" ||
                typeof json.maxBits !== "number" || json.maxBits < 0 || json.maxBits > 32*8) {
            throw new Error("Miner returned JSON in unknown format. " +
                "Check that this URL is a Nano distributed vanity miner.");
        }
        minerInfoElem.style.display = "block";
        minerNameField.innerText = json.name.replace(/[\r\n]/g, "");
        minerMaxCharsField.innerText = estimateCharsFromBits(json.maxBits);
        if (demandElems.hasOwnProperty(json.demand)) {
            for (let key of Object.keys(demandElems)) {
                demandElems[key].style.display = (key === json.demand) ? "block" : "none";
            }
        } else {
            throw new Error("Miner returned unknown demand: " + json.demand.replace(/[\r\n]/g, ""));
        }
        minerInfo = json;
        onPrefixChange();
        minerUrlInUse = url;
        disclaimerCheckboxChanged(2, true);
        document.getElementById("minerContactFailed").style.display = "none";
    } catch(err) {
        document.getElementById("minerContactFailed").style.display = "block";
        document.getElementById("minerContactFailedError").innerText = err.toString();
    }
}

let loadingMinerUrl = localStorage.getItem("minerUrl");
if (loadingMinerUrl) {
    minerUrlInput.value = loadingMinerUrl;
    minerUrlInUse = loadingMinerUrl;
    if (!/^https?:\/\//.test(minerUrlInUse)) {
        minerUrlInUse = "http://" + minerUrlInUse;
    }
} else if (minerUrlInput.value) {
    localStorage.setItem("minerUrl", minerUrlInput.value);
}

let minerUrlTimeout;
function onMinerUrlChange() {
    localStorage.setItem("minerUrl", minerUrlInput.value);
    if (minerUrlTimeout) {
        clearTimeout(minerUrlTimeout);
    }
    minerUrlTimeout = setTimeout(checkMinerUrl, 500);
}

minerUrlInput.addEventListener("keydown", onMinerUrlChange);
minerUrlInput.addEventListener("keypress", onMinerUrlChange);
minerUrlInput.addEventListener("keyup", onMinerUrlChange);
minerUrlInput.addEventListener("change", onMinerUrlChange);

const addressCharacterRegex = /^[13456789abcdefghijkmnopqrstuwxyz*]$/;

const prefixInput = document.getElementById("prefixInput");
const prefixInvalidFirstCharacterElem = document.getElementById("prefixInvalidFirstCharacter");
const prefixInvalidCharacterElem = document.getElementById("prefixInvalidCharacter");
const prefixInvalidCharacterCharacterElem = document.getElementById("prefixInvalidCharacterCharacter");
const prefixTooLarge = document.getElementById("prefixTooLarge");

function countBitsInPrefix(prefix) {
    let bits = 0;
    if (prefix[0] !== "*") {
        bits++;
    }
    for (let c of prefix.slice(1)) {
        if (c !== "*") {
            bits += 32;
        }
    }
    return bits;
}

let prefixInUse = null;
function onPrefixChange() {
    prefixInUse = null;
    disclaimerCheckboxChanged(3, false);
    const prefix = prefixInput.value;
    localStorage.setItem("prefix", prefix);
    prefixInvalidFirstCharacterElem.style.display = "none";
    prefixInvalidCharacterElem.style.display = "none";
    prefixTooLarge.style.display = "none";
    if (!prefix) return;
    if (!/[13*]/.test(prefix[0])) {
        prefixInvalidFirstCharacterElem.style.display = "block";
        return;
    }
    for (let c of prefix) {
        if (!addressCharacterRegex.test(c)) {
            prefixInvalidCharacterCharacterElem.innerText = c;
            prefixInvalidCharacterElem.style.display = "block";
            return;
        }
    }
    const bits = countBitsInPrefix(prefix);
    if (bits > minerInfo.maxBits) {
        prefixTooLarge.style.display = "block";
        return;
    }
    disclaimerCheckboxChanged(3, true);
    prefixInUse = prefixInput.value;
}

prefixInput.addEventListener("keydown", onPrefixChange);
prefixInput.addEventListener("keypress", onPrefixChange);
prefixInput.addEventListener("keyup", onPrefixChange);
prefixInput.addEventListener("change", onPrefixChange);

let loadingPrefix = localStorage.getItem("prefix");
if (loadingPrefix) {
    prefixInput.value = loadingPrefix;
    prefixInUse = loadingPrefix;
}

let miningComplete = false;
let checkMiningStatusInterval = null;
async function checkMiningStatus() {
    try {
        if (!prefixInUse) {
            throw new Error("Attempted to check mining status without prefix set");
        }
        if (!basePublicKeyString) {
            throw new Error("Attempted to check mining status without base public key set");
        }
        if (!minerUrlInUse) {
            throw new Error("Attempted to check mining status without mining URL set");
        }
        const fullUrl = `${minerUrlInUse}/v1/poll?prefix=${prefixInUse}&basePublicKey=${basePublicKeyString}`;
        const res = await promiseTimeout(fetch(fullUrl, {redirect: "follow"}), 750);
        if (res.status < 200 || res.status >= 300) {
            throw new Error("Bad status code: " + res.status);
        }

        const json = await promiseTimeout(res.json(), 500);
        if (json.error) {
            throw new Error("Miner returned error: " + json.error.toString());
        }

        if (json.result) {
            if (typeof json.result !== "string" || json.result.length !== 64 ||
                    !/^[0-9a-fA-F]*$/.test(json.result)) {
                throw new Error("Miner returned invalid result");
            }
            document.getElementById("waitingForMinerInfo").style.display = "none";
            document.getElementById("minerResult").style.display = "block";
            document.getElementById("resultMinerKey").innerText = json.result.toLowerCase();
            const combinedKey = curve25519.addScalars(basePrivateKey, hexToUint8(json.result));
            document.getElementById("resultExpandedPrivateKey").innerText = buf2hex(combinedKey);
            const publicKey = curve25519.scalarBasePointMul(combinedKey);
            const account = publicKeyToNanoAddress(publicKey);
            document.getElementById("resultAccount").innerText = account;
            clearInterval(checkMiningStatusInterval);
            miningComplete = true;
        }

        document.getElementById("minerPollingFailed").style.display = "none";
    } catch(err) {
        document.getElementById("minerPollingFailed").style.display = "block";
        document.getElementById("minerPollingFailedError").innerText = err.toString();
    }
}

function updateStage(newStage) {
    const oldStage = stage;
    if (newStage < 0 || newStage >= stages) {
        throw new Error("attempted to transition to out-of-bound stage");
    }
    if (oldStage !== undefined && oldStage !== null) {
        document.getElementById("stage" + oldStage).style.display = "none";
    }
    stage = newStage;
    localStorage.setItem("stage", newStage);
    document.getElementById("stage" + newStage).style = "block";
    if (stage == 0) {
        prevStageBtn.style.display = "none";
    } else {
        prevStageBtn.style.display = "block";
    }
    if (stage == stages - 1) {
        nextStageBtn.style.display = "none";
    } else {
        nextStageBtn.style.display = "block";
    }
    if (stage < disclaimerCheckboxes.length && disclaimerCheckboxes[stage]) {
        let elem = document.getElementById(disclaimerCheckboxes[stage]);
        disclaimerCheckboxChanged(stage, elem.checked);
    } else {
        disclaimerCheckboxChanged(stage, false);
    }
    if (stage === 2) {
        checkMinerUrl(true);
    }
    if (stage === 3) {
        onPrefixChange();
    }
    if (stage === 4) {
        miningComplete = false;
        checkMiningStatusInterval = setInterval(checkMiningStatus, 1200);
        checkMiningStatus();
    } else {
        if (checkMiningStatusInterval !== null) {
            clearInterval(checkMiningStatusInterval);
        }
        document.getElementById("waitingForMinerInfo").style.display = "table";
        document.getElementById("minerResult").style.display = "none";
    }
}

const clearStorageBtn = document.getElementById("clearStorageBtn");
clearStorageBtn.addEventListener("click", function() {
    if (confirm("Are you SURE you want to erase this key? It will not be recoverable unless you've backed it up.")) {
        localStorage.clear();
        location.reload();
    }
});

nextStageBtn.addEventListener("click", function() {
    updateStage(stage + 1);
});

prevStageBtn.addEventListener("click", function() {
    if (stage == 4) {
        const msg = miningComplete ? ("Are you sure you want to go back? " +
            "You may lose this address, so be sure to back it up first.") :
            "Are you sure you want to cancel the mining of this address?";
        if (confirm(msg)) {
            updateStage(2);
        }
    } else {
        updateStage(stage - 1);
    }
});

let loadingStage = localStorage.getItem("stage");
if (loadingStage) {
    loadingStage = +loadingStage;
    if (loadingStage === 3) {
        loadingStage = 2;
    }
    updateStage(loadingStage);
} else {
    updateStage(0);
}

// Tricks typescript to not add `this.` everywhere we use something from window
}.bind(null));
