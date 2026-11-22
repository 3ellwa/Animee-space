// The app updates itself from GitHub releases (3ellwa/Animee-space, see "publish" in
// package.json): it checks at start and every 6 hours, downloads in the background, and
// installs when you close the app (or right away if you say so).
//
// The websites themselves update on every push like always; this is only for the app shell.

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let getWin = () => null;
let dialog = null;
let manual = false;
let asked = false;

function start(winGetter, electronDialog) {
  getWin = winGetter;
  dialog = electronDialog;
  if (!app.isPackaged) return; // running from source: nothing to update
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async (info) => {
    if (asked) return;
    asked = true;
    const { response } = await dialog.showMessageBox(getWin(), {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `my space ${info.version} is ready`,
      detail: 'Restart to use it now, or it installs next time you close the app.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('update-not-available', () => {
    if (manual) dialog.showMessageBox(getWin(), { type: 'info', message: 'You have the latest version', detail: `my space ${app.getVersion()}` });
    manual = false;
  });
  autoUpdater.on('error', (err) => {
    if (manual) dialog.showMessageBox(getWin(), { type: 'warning', message: 'Couldn’t check for updates', detail: String(err?.message || err) });
    manual = false;
  });
  check(false);
  setInterval(() => check(false), 6 * 60 * 60 * 1000);
}

function check(byHand) {
  if (!app.isPackaged) {
    if (byHand) dialog?.showMessageBox(getWin(), { type: 'info', message: 'Updates only work in the installed app.' });
    return;
  }
  manual = byHand;
  autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = { start, check };
