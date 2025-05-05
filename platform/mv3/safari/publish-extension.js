/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import * as fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/******************************************************************************/

function voidFunc() {
}

/******************************************************************************/

async function getSecrets() {
    const homeDir = os.homedir();
    let currentDir = process.cwd();
    let fileName = '';
    for (;;) {
        fileName = `${currentDir}/ubo_secrets`;
        const stat = await fs.stat(fileName).catch(voidFunc);
        if ( stat !== undefined ) { break; }
        currentDir = path.resolve(currentDir, '..');
        if ( currentDir.startsWith(homeDir) === false ) { return; }
    }
    console.log(`Found secrets in ${fileName}`);
    const text = await fs.readFile(fileName, { encoding: 'utf8' }).catch(voidFunc);
    const secrets = JSON.parse(text);
    return secrets;
}

/******************************************************************************/

async function assetURLFromRelease(assetName) {
    console.log(`Fetching release info for ${ubolVersion}/${assetName} from GitHub`);
    const releaseInfoUrl =  `https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/tags/${ubolVersion}`;
    const request = new Request(releaseInfoUrl, {
        headers: {
            Authorization: githubAuth,
        },
    });
    const response = await fetch(request).catch(voidFunc);
    if ( response === undefined ) { return; }
    if ( response.ok !== true ) { return; }
    const releaseInfo = await response.json().catch(voidFunc);
    if ( releaseInfo === undefined ) { return; }
    if ( releaseInfo.assets === undefined ) { return; }
    for ( const asset of releaseInfo.assets ) {
        if ( asset.name !== assetName ) { continue; }
        return asset.url;
    }
}

/******************************************************************************/

async function assetFromRelease(assetName) {
    const assetURL = await assetURLFromRelease(assetName);
    if ( assetURL === undefined ) { return; }
    console.log(`Fetching ${assetURL}`);
    const request = new Request(assetURL, {
        headers: {
            Authorization: secrets.githubAuth,
            Accept: 'application/octet-stream',
        },
    });
    const response = await fetch(request).catch(voidFunc);
    if ( response.ok !== true ) { return; }
    const data = await response.bytes().catch(voidFunc);
    if ( data === undefined ) { return; }
    const tempDir = await fs.mkdtemp('/tmp/github-asset-');
    const fileName = `${tempDir}/${assetName}`;
    await fs.writeFile(fileName, data);
    return fileName;
}

/******************************************************************************/

const commandLineArgs = (( ) => {
    const args = new Map();
    let name, value;
    for ( const arg of process.argv.slice(2) ) {
        const pos = arg.indexOf('=');
        if ( pos === -1 ) {
            name = arg;
            value = '';
        } else {
            name = arg.slice(0, pos);
            value = arg.slice(pos+1);
        }
        args.set(name, value);
    }
    return args;
})();

/******************************************************************************/

const secrets = await getSecrets();
const githubOwner = process.env.GITHUB_OWNER || '';
const githubRepo = process.env.GITHUB_REPO || '';
const githubAuth = `token ${secrets.github_token}`;
const ubolVersion = commandLineArgs.get('tag');

async function main() {
    if ( secrets === undefined ) { return 'Need secrets'; }
    if ( githubOwner === '' ) { return 'Need GitHub owner'; }
    if ( githubRepo === '' ) { return 'Need GitHub repo'; }

    const asset = commandLineArgs.get('asset');
    if ( asset === undefined ) { return 'Need asset=[...]'; }

    const assetName = path.basename(asset, path.extname(asset));
    const filePath = await assetFromRelease(asset);
    console.log('Asset saved at', filePath);
    const dirPath = path.dirname(filePath);
    await fs.mkdir(`${dirPath}/${assetName}`, { recursive: true });
    execSync(`unzip "${filePath}" -d "${dirPath}/${assetName}"`);

    // Copy files to xcode/Shared (Extension)/Resources/

    // Patch version, build number

    // xcodebuild ... archive

    // Upload to Apple store. investigate doing this through CLI

    // Evaluate: ad hoc distribution to github
}

main().then(result => {
    if ( result !== undefined ) {
        console.log(result);
        process.exit(1);
    }
    process.exit(0);
});
