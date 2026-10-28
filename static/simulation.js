
"use strict";

/* SMART TRAFFIC AI — SIMULATION ONLY */

const DIRECTIONS = ["N", "E", "S", "W"];

const GREEN_DURATION = 10;
const YELLOW_DURATION = 3;
const ALL_RED_DURATION = 1;

const ARRIVAL_INTERVAL_MIN = 6;
const ARRIVAL_INTERVAL_MAX = 7;
const ARRIVAL_CARS_MIN = 4;
const ARRIVAL_CARS_MAX = 5;

const GREEN_MIN_CARS = 3;
const GREEN_MAX_CARS = 4;

// Demo-only chance of a simulated red-light violation per second.
const RED_LIGHT_VIOLATION_CHANCE = 0.006;

let queues = { N: 8, E: 5, S: 7, W: 4 };
let phase = "GREEN";
let activeDirection = "N";
let phaseTimeLeft = GREEN_DURATION;

let running = false;
let simulationTimer = null;
let nextArrivalIn = randomInt(ARRIVAL_INTERVAL_MIN, ARRIVAL_INTERVAL_MAX);

let served = 0;
let totalWait = 0;
let waitSamples = 0;

let emergencyRequests = [];
let violations = [];
let violationCounter = 0;
let emergencyCounter = 0;

let latestViolationText = "No violations recorded";

/* ---------- Helpers ---------- */

function $(id) {
    return document.getElementById(id);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function timestamp() {
    return new Date().toLocaleTimeString();
}

function directionName(direction) {
    return {
        N: "North",
        E: "East",
        S: "South",
        W: "West"
    }[direction] || direction;
}

function log(message) {
    console.log(`[Smart Traffic AI ${timestamp()}] ${message}`);
}

/* ---------- Traffic light display ---------- */

function updateLights() {
    DIRECTIONS.forEach((direction) => {
        const light = $(`light-${direction}`);
        if (!light) return;

        const bulbs = {
            red: light.querySelector(".red"),
            yellow: light.querySelector(".yellow"),
            green: light.querySelector(".green")
        };

        Object.values(bulbs).forEach((bulb) => {
            if (bulb) bulb.classList.remove("active");
        });

        let colour = "red";

        if (direction === activeDirection) {
            if (phase === "GREEN") colour = "green";
            if (phase === "YELLOW") colour = "yellow";
        }

        if (bulbs[colour]) {
            bulbs[colour].classList.add("active");
        }
    });

    const phaseElement = $("phase");
    if (phaseElement) {
        phaseElement.textContent =
            phase === "ALL_RED"
                ? "All Red"
                : `${directionName(activeDirection)} ${phase === "GREEN" ? "Green" : "Yellow"}`;
    }

    const timeElement = $("timeLeft");
    if (timeElement) {
        timeElement.textContent = `${phaseTimeLeft}s`;
    }
}

/* ---------- Queue display and statistics ---------- */

function updateQueueDisplay() {
    DIRECTIONS.forEach((direction) => {
        const countElement = $(`count-${direction}`);
        if (countElement) {
            countElement.textContent = queues[direction];
        }

        const carsElement = $(`cars-${direction}`);
        if (!carsElement) return;

        carsElement.replaceChildren();

        const visibleCars = Math.min(queues[direction], 8);

        for (let i = 0; i < visibleCars; i++) {
            const car = document.createElement("span");
            car.className = "vehicle";
            car.setAttribute("aria-hidden", "true");
            carsElement.appendChild(car);
        }

        if (queues[direction] > visibleCars) {
            const extra = document.createElement("span");
            extra.className = "vehicle-extra";
            extra.textContent = `+${queues[direction] - visibleCars}`;
            carsElement.appendChild(extra);
        }
    });

    const totalElement = $("totalCars");
    if (totalElement) {
        totalElement.textContent = DIRECTIONS.reduce(
            (sum, direction) => sum + queues[direction],
            0
        );
    }

    const servedElement = $("served");
    if (servedElement) {
        servedElement.textContent = served;
    }

    const waitElement = $("averageWait");
    if (waitElement) {
        const average = waitSamples ? totalWait / waitSamples : 0;
        waitElement.textContent = `${average.toFixed(1)}s`;
    }
}

/* ---------- Vehicle arrivals ---------- */

// Every 6–7 seconds, add 4–5 vehicles to each approach.
function addArrivals() {
    nextArrivalIn--;

    if (nextArrivalIn > 0) return;

    DIRECTIONS.forEach((direction) => {
        const arriving = randomInt(
            ARRIVAL_CARS_MIN,
            ARRIVAL_CARS_MAX
        );

        queues[direction] += arriving;

        sendSensor("vehicles_arrived", direction, {
            cars_arrived: arriving,
            remaining_queue: queues[direction]
        });
    });

    log("A new burst of 4–5 vehicles arrived at each direction.");

    nextArrivalIn = randomInt(
        ARRIVAL_INTERVAL_MIN,
        ARRIVAL_INTERVAL_MAX
    );
}

/* ---------- Backend sensor logging ---------- */

async function sendSensor(eventType, direction, details = {}) {
    try {
        const response = await fetch("/api/sensor", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                event: eventType,
                direction,
                timestamp: new Date().toISOString(),
                queue: queues[direction] ?? 0,
                phase,
                ...details
            })
        });

        if (!response.ok) {
            log(`Sensor logging returned HTTP ${response.status}.`);
        }
    } catch (error) {
        // Keep the local simulation running if the backend is unavailable.
        log(`Sensor logging unavailable: ${error.message}`);
    }
}

/* ---------- Serving cars ---------- */

// Serve 3–4 vehicles each second while the direction is green.
function serveVehicles() {
    if (phase !== "GREEN") return;

    const direction = activeDirection;

    if (queues[direction] <= 0) {
        // Empty green approach: begin yellow immediately.
        beginYellowPhase();
        return;
    }

    const carsToServe = Math.min(
        queues[direction],
        randomInt(GREEN_MIN_CARS, GREEN_MAX_CARS)
    );

    queues[direction] -= carsToServe;
    served += carsToServe;

    totalWait += phaseTimeLeft * carsToServe;
    waitSamples += carsToServe;

    sendSensor("vehicles_served", direction, {
        cars_served: carsToServe,
        remaining_queue: queues[direction]
    });

    // If the last car has passed, end green and show yellow.
    if (queues[direction] <= 0) {
        beginYellowPhase();
    }
}

/* ---------- Signal phase transitions ---------- */

function beginYellowPhase() {
    if (phase !== "GREEN") return;

    phase = "YELLOW";
    phaseTimeLeft = YELLOW_DURATION;

    updateLights();
    log(`${directionName(activeDirection)} changed to yellow.`);
}

function beginAllRedPhase() {
    phase = "ALL_RED";
    phaseTimeLeft = ALL_RED_DURATION;

    updateLights();
    log("All directions are red.");
}

function nextDirection() {
    const index = DIRECTIONS.indexOf(activeDirection);
    return DIRECTIONS[(index + 1) % DIRECTIONS.length];
}

function chooseNextDirection() {
    const next = nextDirection();

    const candidates = DIRECTIONS.filter(
        (direction) => queues[direction] > 0
    );

    if (candidates.length === 0) {
        return next;
    }

    const maxQueue = Math.max(
        ...candidates.map((direction) => queues[direction])
    );

    const busiest = candidates.filter(
        (direction) => queues[direction] === maxQueue
    );

    return busiest.includes(next) ? next : busiest[0];
}

function advancePhase() {
    // An empty green queue should already have changed to yellow.
    if (phase === "GREEN") {
        if (queues[activeDirection] <= 0) {
            beginYellowPhase();
        } else {
            phaseTimeLeft--;

            if (phaseTimeLeft <= 0) {
                beginYellowPhase();
            }
        }
        return;
    }

    if (phase === "YELLOW") {
        phaseTimeLeft--;

        if (phaseTimeLeft <= 0) {
            beginAllRedPhase();
        }
        return;
    }

    if (phase === "ALL_RED") {
        phaseTimeLeft--;

        if (phaseTimeLeft <= 0) {
            activeDirection = chooseNextDirection();
            phase = "GREEN";
            phaseTimeLeft = GREEN_DURATION;
            updateLights();

            log(`${directionName(activeDirection)} changed to green.`);
        }
    }
}

/* ---------- Simulated red-light violations ---------- */

function simulateRedLightViolations() {
    DIRECTIONS.forEach((direction) => {
        const isRed =
            phase === "ALL_RED" ||
            direction !== activeDirection ||
            phase === "YELLOW";

        if (!isRed || queues[direction] <= 0) return;

        if (Math.random() < RED_LIGHT_VIOLATION_CHANCE) {
            queues[direction]--;
            recordViolation(direction);
            animateViolationVehicle(direction);
        }
    });
}

function recordViolation(direction) {
    violationCounter++;

    const violation = {
        id: violationCounter,
        time: timestamp(),
        direction,
        vehicle: `SIM-${String(violationCounter).padStart(4, "0")}`,
        type: "Red-light violation",
        status: "Recorded"
    };

    violations.unshift(violation);

    if (violations.length > 100) {
        violations.length = 100;
    }

    latestViolationText =
        `${violation.vehicle} — ${directionName(direction)} — ${violation.time}`;

    const alertText = $("violationAlertText");
    if (alertText) {
        alertText.textContent =
            `${violation.vehicle} ran the red light at the ${directionName(direction)} approach.`;
    }

    const alert = $("violationAlert");
    if (alert) alert.hidden = false;

    renderViolationMonitor();

    sendSensor("red_light_violation", direction, {
        vehicle_id: violation.vehicle,
        violation_id: violation.id,
        simulated: true
    });
}

function animateViolationVehicle(direction) {
    const intersection = $("intersection");
    if (!intersection) return;

    const car = document.createElement("div");
    car.className =
        `violation-car violation-car-${direction.toLowerCase()}`;
    car.textContent = "!";
    car.setAttribute("aria-label", "Simulated red-light runner");

    intersection.appendChild(car);

    setTimeout(() => car.remove(), 2500);
}

function renderViolationMonitor() {
    const table = $("violationTable");

    if (table) {
        table.replaceChildren();

        if (violations.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 5;
            cell.textContent = "No simulated violations recorded yet.";

            row.appendChild(cell);
            table.appendChild(row);
        } else {
            violations.forEach((violation) => {
                const row = document.createElement("tr");

                [
                    violation.time,
                    violation.vehicle,
                    directionName(violation.direction),
                    violation.type,
                    violation.status
                ].forEach((value) => {
                    const cell = document.createElement("td");
                    cell.textContent = String(value);
                    row.appendChild(cell);
                });

                table.appendChild(row);
            });
        }
    }

    const totalElement = $("monitorTotal");
    if (totalElement) {
        totalElement.textContent = violations.length;
    }

    const latestElement = $("latestViolation");
    if (latestElement) {
        latestElement.textContent = latestViolationText;
    }

    const badge = $("violationBadge");
    if (badge) {
        badge.textContent = violations.length;
        badge.hidden = violations.length === 0;
    }
}

/* ---------- Emergency request form ---------- */

function showRequestMessage(message, isError = false) {
    const element = $("requestMessage");
    if (!element) return;

    element.textContent = message;
    element.classList.toggle("error", isError);
    element.classList.toggle("success", !isError);
}

function updateCredentialVisibility() {
    const typeElement = $("requestType");
    const box = $("credentialBox");

    if (!typeElement || !box) return;

    const type = typeElement.value.toLowerCase();

    box.hidden = !(
        type.includes("ambulance") ||
        type.includes("fire") ||
        type.includes("police") ||
        type.includes("emergency")
    );
}

async function submitEmergencyRequest(event) {
    event.preventDefault();

    const type = $("requestType")?.value || "";
    const credential = $("credential")?.value || "";
    const plate = $("plate")?.value || "";
    const road = $("road")?.value || activeDirection;
    const hospital = $("hospital")?.value || "";
    const reason = $("reason")?.value || "";

    if (!type || !road) {
        showRequestMessage("Please complete the required fields.", true);
        return;
    }

    const requestData = {
        type,
        credential,
        plate,
        road,
        hospital,
        reason,
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch("/api/request", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestData)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            showRequestMessage(
                result.message || result.error || "Request could not be submitted.",
                true
            );
            return;
        }

        emergencyCounter++;

        emergencyRequests.unshift({
            id: result.id ?? emergencyCounter,
            ...requestData,
            status: result.status || "Pending"
        });

        showRequestMessage(
            result.message || "Emergency request submitted for review."
        );

        $("requestForm")?.reset();
        updateCredentialVisibility();

        await refreshRequests();
        renderEmergencyQueue();

        sendSensor("emergency_request_submitted", road, {
            request_type: type
        });
    } catch (error) {
        showRequestMessage(
            "Could not contact the server. Check that Flask is running.",
            true
        );
        log(`Emergency request error: ${error.message}`);
    }
}

async function refreshRequests() {
    try {
        const response = await fetch("/api/requests", {
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) return;

        const data = await response.json();
        const requests = Array.isArray(data) ? data : data.requests;

        if (Array.isArray(requests)) {
            emergencyRequests = requests;
            renderEmergencyQueue();
            renderAuditTable();
        }
    } catch (error) {
        log(`Could not refresh emergency requests: ${error.message}`);
    }
}

function renderEmergencyQueue() {
    const container = $("reviewQueue");
    if (!container) return;

    container.replaceChildren();

    if (emergencyRequests.length === 0) {
        container.textContent = "No emergency requests to review.";
        return;
    }

    emergencyRequests.forEach((request) => {
        const item = document.createElement("div");
        item.className = "review-item";

        const details = document.createElement("div");
        details.className = "review-details";

        const heading = document.createElement("strong");
        heading.textContent =
            String(request.type || request.request_type || "Emergency request");

        const description = document.createElement("p");
        description.textContent =
            `${request.plate || "No plate"} · ` +
            `${directionName(request.road || request.direction || "?")} · ` +
            `${request.status || "Pending"}`;

        details.append(heading, description);
        item.appendChild(details);

        const status = String(request.status || "Pending").toLowerCase();

        if (status === "pending" || status === "submitted") {
            const actions = document.createElement("div");
            actions.className = "review-actions";

            const approve = document.createElement("button");
            approve.type = "button";
            approve.textContent = "Approve";
            approve.addEventListener("click", () => {
                reviewRequest(request.id, "approve");
            });

            const reject = document.createElement("button");
            reject.type = "button";
            reject.textContent = "Reject";
            reject.addEventListener("click", () => {
                reviewRequest(request.id, "reject");
            });

            actions.append(approve, reject);
            item.appendChild(actions);
        }

        container.appendChild(item);
    });
}

async function reviewRequest(id, decision) {
    if (id === undefined || id === null) {
        log("Cannot review a request without an ID.");
        return;
    }

    try {
        const response = await fetch(
            `/api/review/${encodeURIComponent(id)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decision })
            }
        );

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            showRequestMessage(
                result.message || result.error || "Review action failed.",
                true
            );
            return;
        }

        showRequestMessage(
            result.message || `Request ${decision}d successfully.`
        );

        await refreshRequests();

        sendSensor("emergency_request_reviewed", activeDirection, {
            request_id: id,
            decision
        });
    } catch (error) {
        showRequestMessage("Could not submit the review decision.", true);
        log(`Review error: ${error.message}`);
    }
}

/* ---------- Emergency audit table ---------- */

function renderAuditTable() {
    const table = $("auditTable");
    if (!table) return;

    const body = table.tagName === "TBODY"
        ? table
        : table.querySelector("tbody");

    if (!body) return;

    body.replaceChildren();

    if (emergencyRequests.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 5;
        cell.textContent = "No emergency events recorded.";

        row.appendChild(cell);
        body.appendChild(row);
        return;
    }

    emergencyRequests.forEach((request) => {
        const row = document.createElement("tr");

        [
            request.timestamp || request.created_at || "—",
            request.type || request.request_type || "Emergency",
            request.plate || "—",
            request.road || request.direction || "—",
            request.status || "Pending"
        ].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });

        body.appendChild(row);
    });
}

/* ---------- Main simulation loop ---------- */

function simulationTick() {
    if (!running) return;

    // Add new traffic in bursts every 6–7 seconds.
    addArrivals();

    // Only the green approach can serve normal traffic.
    if (phase === "GREEN") {
        serveVehicles();
    }

    // Record occasional simulated red-light runners.
    simulateRedLightViolations();

    // Progress green → yellow → all red → next green.
    advancePhase();

    updateLights();
    updateQueueDisplay();
    renderAuditTable();
}

/* ---------- Start, pause and reset ---------- */

function startSimulation() {
    if (running) return;

    running = true;

    if ($("startButton")) $("startButton").disabled = true;
    if ($("pauseButton")) $("pauseButton").disabled = false;

    simulationTimer = setInterval(simulationTick, 1000);

    log("Simulation started.");
}

function pauseSimulation() {
    running = false;

    if (simulationTimer !== null) {
        clearInterval(simulationTimer);
        simulationTimer = null;
    }

    if ($("startButton")) $("startButton").disabled = false;
    if ($("pauseButton")) $("pauseButton").disabled = true;

    log("Simulation paused.");
}

function resetSimulation() {
    pauseSimulation();

    queues = { N: 8, E: 5, S: 7, W: 4 };
    phase = "GREEN";
    activeDirection = "N";
    phaseTimeLeft = GREEN_DURATION;

    nextArrivalIn = randomInt(
        ARRIVAL_INTERVAL_MIN,
        ARRIVAL_INTERVAL_MAX
    );

    served = 0;
    totalWait = 0;
    waitSamples = 0;

    violations = [];
    violationCounter = 0;
    latestViolationText = "No violations recorded";

    const alert = $("violationAlert");
    if (alert) alert.hidden = true;

    const intersection = $("intersection");
    if (intersection) {
        intersection.querySelectorAll(".violation-car").forEach((car) => {
            car.remove();
        });
    }

    updateLights();
    updateQueueDisplay();
    renderViolationMonitor();

    log("Simulation reset.");
}

/* ---------- Traffic / Violation tabs ---------- */

function switchView(view) {
    const trafficPanel = $("trafficPanel");
    const violationsPanel = $("violationsPanel");
    const trafficTab = $("trafficTab");
    const violationsTab = $("violationsTab");

    if (trafficPanel) trafficPanel.hidden = view !== "traffic";
    if (violationsPanel) violationsPanel.hidden = view !== "violations";

    if (trafficTab) {
        trafficTab.classList.toggle("active", view === "traffic");
        trafficTab.setAttribute("aria-selected", String(view === "traffic"));
    }

    if (violationsTab) {
        violationsTab.classList.toggle("active", view === "violations");
        violationsTab.setAttribute("aria-selected", String(view === "violations"));
    }

    if (view === "violations") {
        renderViolationMonitor();
    }
}

function clearViolations() {
    violations = [];
    latestViolationText = "No violations recorded";

    const alert = $("violationAlert");
    if (alert) alert.hidden = true;

    renderViolationMonitor();
}

/* ---------- Initialise ---------- */

function initialiseSimulation() {
    updateLights();
    updateQueueDisplay();
    renderViolationMonitor();
    updateCredentialVisibility();

    $("startButton")?.addEventListener("click", startSimulation);
    $("pauseButton")?.addEventListener("click", pauseSimulation);
    $("resetButton")?.addEventListener("click", resetSimulation);

    $("requestForm")?.addEventListener("submit", submitEmergencyRequest);
    $("requestType")?.addEventListener("change", updateCredentialVisibility);

    $("refreshButton")?.addEventListener("click", async () => {
        await refreshRequests();
        renderAuditTable();
    });

    $("trafficTab")?.addEventListener("click", () => switchView("traffic"));
    $("violationsTab")?.addEventListener("click", () => switchView("violations"));

    $("clearViolationsButton")?.addEventListener("click", clearViolations);

    if ($("pauseButton")) {
        $("pauseButton").disabled = true;
    }

    refreshRequests();

    log("Simulation engine ready.");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseSimulation);
} else {
    initialiseSimulation();
}
