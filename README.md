# Dockboard

A calm, Apple-style board that turns Google Calendar events into breathing squircle blocks.

- **Green → yellow → red** continuously as the deadline approaches; breathing speeds up with urgency.
- Click a block for details and **subtasks** (parsed from `- ` lines in the event description, or add your own).
- Map each Google calendar to a category in **Settings**.

Run: `python3 -m http.server 8000`, open http://localhost:8000. Starts with demo data; to connect Google, add an OAuth Web Client ID in Settings (origin `http://localhost:8000`, Calendar API enabled). Read-only scope, data stays in your browser.
