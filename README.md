# Maps Travel Planner Extension

A Chrome extension that enhances Google Maps with a visual travel planning system.

## Features

- Add markers with notes and categories
- Connect locations with routes
- Choose travel modes (driving, walking, biking, transit)
- Route labels showing time and distance directly on the map
- Multi-day trip planning
- Drag-and-drop itinerary ordering
- Manual graph-based routing
- Pause mode for normal Google Maps use
- Auto-save trips

## Installation

### Option A: Download ZIP (Step-by-step)

1. Open this repository on GitHub.
2. Click **Code** -> **Download ZIP**.
3. In `Downloads`, right-click the ZIP and choose **Extract All...** (do not load the ZIP directly).
4. Open the extracted folder and make sure `manifest.json` is inside the folder you will select.
5. Open Chrome and go to `chrome://extensions`.
6. Enable **Developer mode**.
7. Click **Load unpacked**.
8. Select the extracted folder that contains `manifest.json`.
9. Open Google Maps.

### Option B: Clone with Git

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the cloned project folder (the one containing `manifest.json`).
6. Open Google Maps.

## Tech Stack

- Chrome Extension (Manifest V3)
- React
- Google Maps overlay integration

## Limitations

- Desktop only
- Depends on Google Maps UI structure

## Future Plans

- Web app version
- Mobile app
- Route optimization
- Sharing trips

## Demo

![Planner Overview](screenshots/planner-overview.png)
![Routes In Action](screenshots/routes-in-action.png)

## Author

Peiyun Li
