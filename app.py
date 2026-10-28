from flask import Flask, render_template, request, jsonify, send_file
from pathlib import Path
from datetime import datetime
import csv
import threading
import uuid
import re

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SENSOR_DIR = DATA_DIR / "sensors"

DATA_DIR.mkdir(exist_ok=True)
SENSOR_DIR.mkdir(exist_ok=True)

lock = threading.Lock()
requests_log = []
next_event = 1

ROADS = ["North", "East", "South", "West"]
DEMO_AMBULANCE_CODE = "AMB-DEMO-01"


def write_csv(path, row, fields):
    """Add one row to a CSV file, creating it if needed."""
    with lock:
        new_file = not path.exists()

        with path.open("a", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=fields)

            if new_file:
                writer.writeheader()

            writer.writerow(row)


def save_audit(event):
    """Save an emergency request or review decision."""
    fields = [
        "event_id", "timestamp", "plate", "type", "road",
        "hospital", "reason", "status", "detail"
    ]

    write_csv(DATA_DIR / "emergency_audit.csv", event, fields)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/download/audit")
def download_audit():
    """Download the emergency audit CSV."""
    path = DATA_DIR / "emergency_audit.csv"

    if not path.exists():
        return "No audit records have been created yet.", 404

    return send_file(path, as_attachment=True)


@app.route("/api/sensor", methods=["POST"])
def sensor_log():
    data = request.get_json(silent=True) or {}

    road = data.get("road", "")
    if road not in ROADS:
        return jsonify({"error": "Unknown road"}), 400

    try:
        queue_length = int(data.get("queue_length", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Queue length must be a number."}), 400

    event = {
        "timestamp": datetime.now().astimezone().isoformat(
            timespec="seconds"
        ),
        "sensor": road + "_sensor",
        "vehicle_id": str(data.get("vehicle_id", ""))[:40],
        "event": str(data.get("event", "arrival"))[:40],
        "queue_length": max(0, min(10000, queue_length)),
        "signal_state": str(data.get("signal_state", "red"))[:20],
    }

    path = SENSOR_DIR / (road.lower() + "_sensor.csv")

    fields = [
        "timestamp", "sensor", "vehicle_id",
        "event", "queue_length", "signal_state"
    ]

    write_csv(path, event, fields)
    return jsonify({"saved": True})


@app.route("/api/request", methods=["POST"])
def create_request():
    global next_event

    data = request.get_json(silent=True) or {}

    kind = data.get("type", "")
    plate = str(data.get("plate", "")).strip().upper()
    road = data.get("road", "")
    hospital = str(data.get("hospital", "")).strip()[:100]
    reason = str(data.get("reason", "")).strip()[:300]

    if kind not in ("ambulance", "medical"):
        return jsonify({"error": "Choose a valid request type."}), 400

    if road not in ROADS:
        return jsonify({"error": "Choose a valid road."}), 400

    if not re.fullmatch(r"[A-Z0-9 -]{4,16}", plate):
        return jsonify({
            "error": "Enter a valid-looking demo plate."
        }), 400

    if not hospital or not reason:
        return jsonify({
            "error": "Enter the hospital and reason."
        }), 400

    if kind == "ambulance":
        code = str(data.get("credential", "")).strip()

        if code != DEMO_AMBULANCE_CODE:
            status = "rejected"
            detail = "Demo ambulance code not recognised."
        else:
            status = "approved"
            detail = "Demo credential accepted; priority queued."
    else:
        status = "pending"
        detail = "Waiting for operator review."

    event = {
        "event_id": "EVT-" + uuid.uuid4().hex[:8].upper(),
        "timestamp": datetime.now().astimezone().isoformat(
            timespec="seconds"
        ),
        "plate": plate,
        "type": kind,
        "road": road,
        "hospital": hospital,
        "reason": reason,
        "status": status,
        "detail": detail,
    }

    with lock:
        requests_log.append(event)
        next_event += 1

    save_audit(event)
    return jsonify(event)


@app.route("/api/requests")
def get_requests():
    with lock:
        return jsonify(list(reversed(requests_log)))


@app.route("/api/review/<event_id>", methods=["POST"])
def review_request(event_id):
    data = request.get_json(silent=True) or {}
    decision = data.get("decision")

    if decision not in ("approved", "rejected"):
        return jsonify({"error": "Invalid decision."}), 400

    with lock:
        event = next(
            (
                item for item in requests_log
                if item["event_id"] == event_id
            ),
            None
        )

        if not event:
            return jsonify({"error": "Request not found."}), 404

        if event["type"] != "medical" or event["status"] != "pending":
            return jsonify({
                "error": "This request cannot be reviewed."
            }), 400

        event["status"] = decision
        event["detail"] = "Operator " + decision + " the request."
        updated = dict(event)

    # Record the operator's decision as a separate audit entry.
    review_event = {
        **updated,
        "event_id": updated["event_id"] + "-REVIEW",
        "timestamp": datetime.now().astimezone().isoformat(
            timespec="seconds"
        ),
    }

    save_audit(review_event)
    return jsonify(updated)


@app.route("/api/priority")
def get_priority():
    """Return approved requests for the demo signal controller."""
    with lock:
        approved = [
            {
                "event_id": item["event_id"],
                "road": item["road"],
                "type": item["type"],
            }
            for item in requests_log
            if item["status"] == "approved"
        ]

    return jsonify(approved)


if __name__ == "__main__":
    print("Smart Traffic AI is starting.")
    print("Open http://127.0.0.1:800 in your browser.")

    app.run(host="127.0.0.1", port=800, debug=False)