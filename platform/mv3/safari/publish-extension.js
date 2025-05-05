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

async function getRepoRoot() {
    const homeDir = os.homedir();
    let currentDir = process.cwd();
    for (;;) {
        const fileName = `${currentDir}/.git`;
        const stat = await fs.stat(fileName).catch(voidFunc);
        if ( stat !== undefined ) { return currentDir; }
        currentDir = path.resolve(currentDir, '..');
        if ( currentDir.startsWith(homeDir) === false ) { return; }
    }
}

/******************************************************************************/

async function getReleaseInfo() {
    console.log(`Fetching release info for ${ubolVersion} from GitHub`);
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
    return releaseInfo;
}

/******************************************************************************/

async function getAssetInfo(assetName) {
    const releaseInfo = await getReleaseInfo();
    if ( releaseInfo === undefined ) { return; }
    if ( releaseInfo.assets === undefined ) { return; }
    for ( const asset of releaseInfo.assets ) {
        if ( asset.name.includes(assetName) ) { return asset; }
    }
}

/******************************************************************************/

async function downloadAssetFromRelease(assetInfo) {
    const assetURL = assetInfo.url;
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
    const fileName = `${tempDir}/${assetInfo.name}`;
    await fs.writeFile(fileName, data);
    return fileName;
}

/******************************************************************************/

async function uploadAssetToRelease(assetPath, mimeType) {
    console.log(`Uploading "${assetPath}" to GitHub...`);
    const data = await fs.readFile(assetPath).catch(( ) => { });
    if ( data === undefined ) { return; }
    const releaseInfo = await getReleaseInfo();
    if ( releaseInfo.upload_url === undefined ) { return; }
    const assetName = path.basename(assetPath);
    const uploadURL = releaseInfo.upload_url.replace('{?name,label}', `?name=${assetName}`);
    console.log('Upload URL:', uploadURL);
    const request = new Request(uploadURL, {
        body: new Int8Array(data.buffer, data.byteOffset, data.length),
        headers: {
            Authorization: githubAuth,
            'Content-Type': mimeType,
        },
        method: 'POST',
    });
    const response = await fetch(request).catch(( ) => { });
    if ( response === undefined ) { return; }
    const json = await response.json();
    console.log(json);
    return json;
}

/******************************************************************************/

async function deleteAssetFromRelease(assetURL) {
    print(`Remove ${assetURL} from GitHub release ${ubolVersion}...`);
    const request = new Request(assetURL, {
        headers: {
            Authorization: githubAuth,
        },
        method: 'DELETE',
    });
    const response = await fetch(request);
    return response.ok;
}

/******************************************************************************/

async function getManifest(path) {
    const text = await fs.readFile(path, { encoding: 'utf8' });
    return JSON.parse(text);
}

/******************************************************************************/

async function patchXcodeVersion(manifest, xcprojPath) {
    let text = await fs.readFile(xcprojPath, { encoding: 'utf8' });
    text = text.replaceAll(/MARKETING_VERSION = [^;]*;/g,
        `MARKETING_VERSION = ${manifest.version};`
    );
    if ( commandLineArgs.distribute !== undefined ) {
        const match = /CURRENT_PROJECT_VERSION = ([^;]*);/.exec(text);
        if ( match ) {
            let buildNo = parseInt(match[1], 10) || 1;
            buildNo += 1;
            text = text.replaceAll(/CURRENT_PROJECT_VERSION = [^;]*;/g,
                `CURRENT_PROJECT_VERSION = ${buildNo};`
            );
        }
    }
    await fs.writeFile(xcprojPath, text);
}

/******************************************************************************/

const commandLineArgs = (( ) => {
    const args = Object.create(null);
    let name, value;
    for ( const arg of process.argv.slice(2) ) {
        const pos = arg.indexOf('=');
        if ( pos === -1 ) {
            name = arg;
            value = true;
        } else {
            name = arg.slice(0, pos);
            value = arg.slice(pos+1);
        }
        args[name] = value;
    }
    return args;
})();

/******************************************************************************/

const secrets = await getSecrets();
const githubOwner = commandLineArgs.githubOwner || '';
const githubRepo = commandLineArgs.githubRepo || '';
const githubAuth = `Bearer ${secrets.github_token}`;
const ubolVersion = commandLineArgs.tag;
const localRepoRoot = await getRepoRoot() || '';

async function main() {
    if ( secrets === undefined ) { return 'Need secrets'; }
    if ( githubOwner === '' ) { return 'Need GitHub owner'; }
    if ( githubRepo === '' ) { return 'Need GitHub repo'; }
    if ( localRepoRoot === '' ) { return 'Need local repo root'; }
    if ( commandLineArgs.asset === undefined ) { return 'Need asset=[...]'; }

    const assetInfo = await getAssetInfo(commandLineArgs.asset);

    console.log(`GitHub owner: "${githubOwner}"`);
    console.log(`GitHub repo: "${githubRepo}"`);
    console.log(`Release tag: "${ubolVersion}"`);
    console.log(`Release asset: "${assetInfo.name}"`);
    console.log(`Local repo root: "${localRepoRoot}"`);

    // Fetch asset from GitHub repo
    const assetName = path.basename(assetInfo.name, path.extname(assetInfo.name));
    const filePath = await downloadAssetFromRelease(assetInfo);
    console.log('Asset saved at', filePath);
    const tempdirPath = path.dirname(filePath);
    await fs.mkdir(`${tempdirPath}/${assetName}`, { recursive: true });
    execSync(`unzip "${filePath}" -d "${tempdirPath}/${assetName}"`);

    const xcodeDir = `${localRepoRoot}/platform/mv3/safari/xcode`;
    const resourcesPath = `${xcodeDir}/Shared (Extension)/Resources/`;

    // Remove content of xcode/Shared (Extension)/Resources/
    console.log('Remove content of', resourcesPath);
    execSync(`rm -rf "${resourcesPath}/"*`);

    // Copy files to xcode/Shared (Extension)/Resources/
    console.log('Copy package files to', resourcesPath);
    execSync(`cp -R "${tempdirPath}/${assetName}/"* "${resourcesPath}"`);

    console.log('Read manifest', resourcesPath);
    const manifestPath = `${xcodeDir}/Shared (Extension)/Resources/manifest.json`;
    const manifest = await getManifest(manifestPath);

    // Patch xcode version, build number
    console.log('Patch xcode project with manifest version');
    const xcprojDir = `${xcodeDir}/uBlock Origin Lite.xcodeproj`;
    await patchXcodeVersion(manifest, `${xcprojDir}/project.pbxproj`);

    // xcodebuild ... archive
    const buildNamePrefix = `uBOLite_${manifest.version}`;

    // Build for iOS
    if ( commandLineArgs.ios ) {
        console.log(`Building archive ${buildNamePrefix}.ios`);
        execSync(`xcodebuild clean archive \\
            -archivePath "${tempdirPath}/${buildNamePrefix}.ios" \\
            -configuration release \\
            -destination 'generic/platform=iOS' \\
            -project "${xcprojDir}" \\
            -scheme "uBlock Origin Lite (iOS)" \\
        `);
        if ( commandLineArgs.publish === 'github' ) {
            console.log(`Building app from ${buildNamePrefix}.ios.xarchive`);
            execSync(`xcodebuild -exportArchive \\
                -archivePath "${tempdirPath}/${buildNamePrefix}.ios.xcarchive" \\
                -exportPath "${tempdirPath}/${buildNamePrefix}.ios" \\
                -exportOptionsPlist "${xcodeDir}/exportOptionsAdHoc.ios.plist" \\
            `);
        }
    }

    // Build for MacOX
    if ( commandLineArgs.macos ) {
        console.log(`Building archive ${buildNamePrefix}.macos`);
        execSync(`xcodebuild clean archive \\
            -archivePath "${tempdirPath}/${buildNamePrefix}.macos" \\
            -configuration release \\
            -destination 'generic/platform=macOS' \\
            -project "${xcprojDir}" \\
            -scheme "uBlock Origin Lite (macOS)" \\
        `);
        console.log(`Building app from ${buildNamePrefix}.macos.xarchive`);
        execSync(`xcodebuild -exportArchive \\
            -archivePath "${tempdirPath}/${buildNamePrefix}.macos.xcarchive" \\
            -exportPath "${tempdirPath}/${buildNamePrefix}.macos" \\
            -exportOptionsPlist "${xcodeDir}/exportOptionsAdHoc.macos.plist" \\
        `);
        if ( commandLineArgs.publish === 'github' ) {
            execSync(`cd "${tempdirPath}" && zip -r \\
                "${buildNamePrefix}.macos.zip" \\
                "${buildNamePrefix}.macos"/* \\
            `);
            await uploadAssetToRelease(`${tempdirPath}/${buildNamePrefix}.macos.zip`, 'application/zip');
            await deleteAssetFromRelease(assetInfo.url);
        }
    }

    // Clean up
    if ( commandLineArgs.keep !== true ) {
        console.log(`Removing ${tempdirPath}`);
        execSync(`rm -rf "${tempdirPath}"`);
    }

    console.log('Done');
}

main().then(result => {
    if ( result !== undefined ) {
        console.log(result);
        process.exit(1);
    }
    process.exit(0);
});
