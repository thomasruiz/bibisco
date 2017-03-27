/*
 * Copyright (C) 2014-2017 Andrea Feccomandi
 *
 * Licensed under the terms of GNU GPL License;
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.gnu.org/licenses/gpl-2.0.html
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY.
 * See the GNU General Public License for more details.
 *
 */
'use strict';
const electron = require('electron');
const app = electron.app;
const env = process.env.NODE_ENV || 'development';

// adds debug features like hotkeys for triggering dev tools and reload
require('electron-debug')();

// adds os info
global.os = process.platform;

// adds file system
const fs = require('fs-extra');
global.fs = fs;

// add winston logger
const logger = require('winston');
logger.level = (env === 'development' ? 'debug' : 'info');
logger.add(logger.transports.File, {
	filename: "./logs/bibisco.log",
	json: false,
	maxsize: 1000000,
	maxFiles: 2,
	handleExceptions: true,
	humanReadableUnhandledException: true,
	formatter: function(options) {
		var dateFormat = require('dateformat');
		// Return string will be passed to logger.
		return dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss:l") + ' ' + options.level
			.toUpperCase() + ' ' + (options.message ? options.message : '') +
			(options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(
				options.meta) : '');
	}
});
global.logger = logger;

logger.debug('**** This platform is ' + process.platform);

// add zipper/unzipper
const yazl = require("yazl");
const yauzl = require("yauzl");
const path = require("path");
const mkdirp = require("mkdirp");
const walkSync = require('walk-sync');
global.zip = initZip();

// add loki
const loki = require('lokijs');
const LokiFsSyncAdapter = require(
	'../app/adapters/lokijs/loki-fs-sync-adapter.js');

// add project db connection
global.projectdbconnection = initProjectDbConnection();

// add bibisco db connection
global.bibiscodbconnection = initBibiscoDbConnection();

// add dialog
const {
	dialog
} = require('electron');
global.dialog = dialog;

// add uuid
const uuid = require('uuid/v1');
global.uuid = uuid;

// prevent window being garbage collected
let mainWindow;

function onClosed() {
	// dereference the window
	// for multiple windows store them in an array
	mainWindow = null;
}

function createMainWindow() {
	const win = new electron.BrowserWindow({
		width: 800,
		height: 600
	});

	win.loadURL(`file://${__dirname}/index.html`, {
		"extraHeaders": "pragma: no-cache\n"
	});
	win.on('closed', onClosed);

	return win;
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (!mainWindow) {
		mainWindow = createMainWindow();
	}
});

app.on('ready', () => {
	mainWindow = createMainWindow();
});

function initZip() {
	return {
		zipFolder: function(folderToZip, zippedFilePath) {
			logger.debug('Remote zipFolder start: ' + folderToZip);

			let zipfile = new yazl.ZipFile();
			let fileList = walkSync(folderToZip, {
				directories: false,
				globs: ['**/!(*.DS_Store)']
			})
			for (let i = 0; i < fileList.length; i++) {
				logger.debug('Processing ' + fileList[i]);
				zipfile.addFile(folderToZip + '/' + fileList[i], fileList[i]);
			}

			// pipe() can be called any time after the constructor
			zipfile.outputStream.pipe(fs.createWriteStream(zippedFilePath)).on("close",
				function() {
					console.log("done");
				});
			// call end() after all the files have been added
			zipfile.end();

			logger.debug('Remote zipFolder end');

		},
		unzip: function(zippedFilePath, destinationFolder) {
			logger.debug('Remote unzip start: ' + zippedFilePath);
			yauzl.open(zippedFilePath, {
				lazyEntries: true
			}, function(err, zipfile) {
				// From documentation: https://github.com/thejoshwolfe/yauzl
				// The callback is given the arguments (err, zipfile).
				// An err is provided if the End of Central Directory Record cannot be
				// found, or if its metadata appears malformed. This kind of error
				// usually indicates that this is not a zip file.
				logger.error("*** ERROR: " + err);

				zipfile.readEntry();
				zipfile.on("entry", function(entry) {
					logger.debug('Processing ' + entry.fileName);
					if (/\/$/.test(entry.fileName)) {
						// directory file names end with '/'
						mkdirp(destinationFolder + '/' + entry.fileName, function(err) {
							if (err) throw err;
							zipfile.readEntry();
						});
					} else {
						// file entry
						zipfile.openReadStream(entry, function(err, readStream) {
							if (err) throw err;
							// ensure parent directory exists
							mkdirp(destinationFolder + '/' + path.dirname(entry.fileName),
								function(err) {
									if (err) throw err;
									readStream.pipe(fs.createWriteStream(destinationFolder + '/' +
										entry.fileName));
									readStream.on("end", function() {
										zipfile.readEntry();
									});
								});
						});
					}
				});
			});
		}
	}
}


function initProjectDbConnection() {
	return {
		// add function to create project db
		create: function(dbName, dbPath) {
			fs.mkdirSync(dbPath);
			var projectdbfilepath = dbPath + '/' + dbName + '.json';
			var projectdb = new loki(projectdbfilepath, {
				adapter: new LokiFsSyncAdapter()
			});
			projectdb.saveDatabase(function(error) {
				logger.debug('Database ' + projectdbfilepath + ' created!');
			});

			return projectdb;
		},

		// add function to load project db
		load: function(dbName, dbPath) {
			var projectdbfilepath = dbPath + '/' + dbName + '.json';
			var projectdb = new loki(projectdbfilepath, {
				adapter: new LokiFsSyncAdapter()
			});
			projectdb.loadDatabase({}, function(result) {
				logger.debug('Database ' + projectdbfilepath + ' loaded!');
			});
			return projectdb;
		}
	}
}

function initBibiscoDbConnection() {
	return {
		// add function to load bibisco db
		load: function() {
			var bibiscodb = new loki('./db/bibisco.json', {
				adapter: new LokiFsSyncAdapter()
			});
			bibiscodb.loadDatabase({}, function(result) {
				logger.info('bibisco.json db loaded');
			});
			return bibiscodb;
		}
	}
}

/*function walkSync(dir, filelist) {
	var path = path || require('path');
	var fs = fs || require('fs'),
		files = fs.readdirSync(dir);
	filelist = filelist || [];
	files.forEach(function(file) {
		if (fs.statSync(path.join(dir, file)).isDirectory()) {
			filelist = walkSync(path.join(dir, file), filelist);
		} else {
			filelist.push(file);
		}
	});
	return filelist;
};*/
