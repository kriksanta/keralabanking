# Connect the issue form and admin dashboard

The website stays on GitHub Pages. Google Apps Script receives the issue form, saves submissions in your private Sheet, and verifies the admin account. Margins and the footer notice continue to save to GitHub with your per-save token.

## One-time Google setup

1. Open https://sheets.google.com and create a blank Sheet named **Cash Tool Issues**. Keep it private.
2. Copy its spreadsheet ID: the part between `/d/` and `/edit` in the Sheet URL.
3. In the Sheet, choose **Extensions → Apps Script**.
4. Replace the contents of `Code.gs` with the supplied [Code.gs](./Code.gs), then save.
5. Open **Project Settings** (gear in the left sidebar), scroll to **Script Properties**, and add:

   | Property | Value |
   | --- | --- |
   | `SPREADSHEET_ID` | The ID copied in step 2 |
   | `ADMIN_USERNAME` | `sreejith` |
   | `ADMIN_PASSWORD` | The admin password you supplied in this chat |

   Save the properties. Do not put the password into a GitHub file.

6. Choose **Deploy → New deployment → Select type → Web app**.
7. Set **Execute as: Me** and **Who has access: Anyone**. Customers do not need Google accounts. The script requires an admin session to read the inbox or change credentials.
8. Click **Deploy**, authorize access to your Sheet, and copy the **Web app URL** ending in `/exec`. If Google says the app is unverified, review your own script and continue through the advanced option. Only approve the Sheet permissions for this project you created.
9. Send that `/exec` URL in this chat so it can be connected, or put it in the repository's `site-config.json`:

   ```json
   {
     "issueBackendUrl": "YOUR_DEPLOYED_WEB_APP_URL"
   }
   ```

10. Publish the updated website files to GitHub using the commands below.

## Publish website files

Run in PowerShell, one line at a time:

```powershell
cd "C:\Users\sreej\Documents\Codex\2026-10-06\nee\repo-inspect"
git add index.html sw.js admin-panel.css admin-panel.js site-config.json notice.json issue-backend/Code.gs issue-backend/README.md
git commit -m "Add admin dashboard, issue form and footer notices"
git push origin main
```

Do not stage the generated `.wrangler` folder. If the dashboard later saves margins or a notice to GitHub, run `git pull --ff-only` before making further local commits.

## Using the app

- Normal users keep their existing app login.
- Your admin credentials on the same login screen open the dashboard once Google is connected.
- **Margins:** add or remove businesses, then save with a repository token as before.
- **Submissions:** read issues and press Refresh for new entries. The latest 500 entries appear; the Sheet retains older entries.
- **Notice board:** save footer text to GitHub. Clear the text to hide it. Visitors receive the update after GitHub Pages publishes it and the app reloads the notice (every minute while visible).
- **Account:** change the admin username and/or password after entering the current password. Leave the new password empty to change only the username. Other admin sessions are invalidated. The normal app username `admin` is reserved.
- Admin sessions stay in the current browser tab for up to six hours. Google may clear an inactive cached session sooner; log in again if asked.

## Updating or recovering the backend

After changing `Code.gs`, choose **Deploy → Manage deployments → Edit → Version: New version → Deploy**. Keep the same `/exec` URL.

If you forget the admin credentials, change `ADMIN_USERNAME` / `ADMIN_PASSWORD` in Script Properties and set `AUTH_VERSION` to a new unique value to invalidate previous sessions. Changing properties does not require redeployment.

The form service accepts the hosted origin `https://kriksanta.github.io`. A local `file://` preview cannot submit forms or authenticate an admin. No admin password is bundled in the website. The dashboard interface itself is downloadable static code; private inbox access is enforced by Apps Script and GitHub edits are enforced by your token.

Apps Script has Google's usage quotas. This implementation adds a basic submission cooldown and rate cap for a small audience; it is not intended for large public traffic. If a managed Google account does not allow deployment to Anyone, use an account that permits it or select a different form service.

Google deployment reference: https://developers.google.com/apps-script/guides/web
