// Get references to HTML elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');
const authorText = document.getElementById('author');
const loadingText = document.getElementById('loading');
const container = document.getElementById('container');
const downloadBtn = document.getElementById('download-btn');

// --- State and Configuration ---
let detector;
let poses;
let mediaRecorder;
let recordedChunks = [];
let lastRecordedBlob = null;
let noPoseStart = null; // Timer for stopping recording

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// Application states based on your flowchart
const AppState = {
    IDLE: 'IDLE', // Not detecting a person or waiting for ready pose
    READY: 'READY', // Person is in the "ready" stance
    SWINGING: 'SWINGING', // Swing has been detected
    RECORDING: 'RECORDING' // Currently recording the swing
};
let currentState = AppState.IDLE;

// --- Main Setup Function ---
async function main() {
    // 1. Load the MoveNet model
    // statusText.innerText = 'Presented by Gurbee';
    statusText.innerText = 'Loading PoseNet model...';
    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet, 
        // { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING } // Use a lightweight model for speed
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER }
    );

    // 2. Set up the camera
    await setupCamera();
    
    // Hide the loading text and show the video container
    authorText.style.display = 'none';
    loadingText.style.display = 'none';
    container.style.display = 'block';

    // 3. Start the real-time detection loop
    detectPoseInRealTime();
}

// --- Camera Setup ---
async function setupCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusText.innerText = 'getUserMedia() is not supported by your browser';
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: VIDEO_WIDTH,
                height: VIDEO_HEIGHT,
                facingMode: { exact: 'environment' } // Strictly require rear camera
            },
            audio: true
        });
        video.srcObject = stream;

        // Ask for permission to save files
        hasSavePermission = confirm("Allow this page to save images and videos?");
        
        
        // video.addEventListener('loadeddata', () => {
        //     // Adjust the container to the video's aspect ratio
        //     const aspectRatio = video.videoWidth / video.videoHeight;
        //     container.style.width = `${VIDEO_WIDTH}px`;
        //     container.style.height = `${VIDEO_HEIGHT}px`;
        //     canvas.width = video.videoWidth;
        //     canvas.height = video.videoHeight;
            
        //     // // Flip the video element horizontally
        //     // video.style.transform = 'scaleX(-1)';
        //     // canvas.style.transform = 'scaleX(-1)';
            
        //     // currentState = AppState.IDLE; // Start in IDLE state
        //     // statusText.innerText = 'Ready to swing!';
        // });
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
            // Set canvas dimensions to match the video
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            resolve(video);
            };
        });
    } catch (err) {
        console.error(err);
        statusText.innerText = `Error accessing camera: ${err.message}. Trying front camera.`;
        // Fallback to front camera if rear is not available
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: VIDEO_WIDTH,
                    height: VIDEO_HEIGHT,
                },
                audio: true
            });
            video.srcObject = stream;
            // ... (rest of the setup logic for front camera)
        } catch (frontErr) {
            statusText.innerText = `Error accessing any camera: ${frontErr.message}`;
        }
    }
}

// --- Real-time Detection Loop ---
async function detectPoseInRealTime() {
    // Estimate poses from the video feed
    poses = await detector.estimatePoses(video);

    // Clear the previous drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = Date.now();

    // --- Advanced Core Logic ---
    if (poses && poses.length > 0) {
        noPoseStart = null; // Reset timer if pose is detected
        const keypoints = poses[0].keypoints;
        drawSkeleton(keypoints); // draw pose show that it's working

        // --- Advanced pose history tracking ---
        if (!window.poseHistory) window.poseHistory = [];
        const history = window.poseHistory;
        
        // Extract key y/x for wrists, shoulders, hips
        function get(name) {
            return keypoints.find(k => k.name === name || k.part === name);
        }
        const leftWrist = get('left_wrist');
        const rightWrist = get('right_wrist');
        const leftShoulder = get('left_shoulder');
        const rightShoulder = get('right_shoulder');
        const leftHip = get('left_hip');
        const rightHip = get('right_hip');
        history.push({
            t: now,
            leftWristY: leftWrist?.y,
            rightWristY: rightWrist?.y,
            leftShoulderY: leftShoulder?.y,
            rightShoulderY: rightShoulder?.y,
            leftHipX: leftHip?.x,
            rightHipX: rightHip?.x
        });
        // Keep only last 2s
        while (history.length > 0 && now - history[0].t > 2000) history.shift();

        // Advanced ready pose: hands/arms below shoulders, and still
        function isReadyPose() {
            if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder) return false;
            // Both hands below both shoulders
            const handsBelowShoulders = leftWrist.y > leftShoulder.y && rightWrist.y > rightShoulder.y;
            // Stillness: wrists move < 10px in last 0.5s
            const t0 = now - 500;
            const recent = history.filter(h => h.t >= t0);
            if (recent.length < 2) return false;
            const maxMove = Math.max(
                ...['leftWristY', 'rightWristY'].map(k => {
                    const vals = recent.map(h => h[k]).filter(v => v != null);
                    return vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
                })
            );
            const still = maxMove < 10;
            return handsBelowShoulders && still;
        }

        // End pose of the swing
        function isEndPose() {
            if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder) return false;
            const handsAboveShoulders = leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
            // Check for recent hip rotation
            const t0 = now - 1000;
            const recent = history.filter(h => h.t >= t0);
            if (recent.length < 2) return false;
            const hipMove = Math.max(
                ...['leftHipX', 'rightHipX'].map(k => {
                    const vals = recent.map(h => h[k]).filter(v => v != null);
                    return vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
                })
            );
            return handsAboveShoulders && hipMove > 30;
        }

        // --- State Machine ---
        if (currentState === AppState.IDLE && isReadyPose()) {
            currentState = AppState.READY;
            statusText.innerText = 'Ready pose detected. Waiting for strike...';
            startRecording();
        } else if (currentState === AppState.READY && isEndPose()) {
            currentState = AppState.SWINGING;
            statusText.innerText = 'Swing finished! Recording...';
        }
    } else {
        // No person detected
        if (currentState === AppState.SWINGING) {
            if (noPoseStart === null) {
                noPoseStart = now;
            } else if (now - noPoseStart > 5000) {
                statusText.innerText = 'Stopping recording...';
                stopRecordingAndSave();
                currentState = AppState.IDLE;
                noPoseStart = null;
            }
        } else if (currentState !== AppState.IDLE) {
            currentState = AppState.IDLE;
            statusText.innerText = 'No person detected.';
        }
    }

    // Loop forever
    requestAnimationFrame(detectPoseInRealTime);
// --- Pose Detection Helpers ---


// --- Video Recording Functions ---
function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    recordedChunks = [];
    const stream = video.srcObject;
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/mp4' });
    mediaRecorder.ondataavailable = function(e) {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = function() {
        lastRecordedBlob = new Blob(recordedChunks, { type: 'video/mp4' });

        // Save video automatically when strike is detected
        const videoLink = document.createElement('a');
        videoLink.style.display = 'none';
        videoLink.href = URL.createObjectURL(lastRecordedBlob);
        videoLink.download = 'strike_video.mp4';
        document.body.appendChild(videoLink);
        videoLink.click();
        setTimeout(() => {
            document.body.removeChild(videoLink);
        }, 100);
        statusText.innerText = 'Video saved! Ready to swing again.';
    };
    mediaRecorder.start();
}

function stopRecordingAndSave() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}
}

// --- Drawing Functions for Visualization ---
function drawSkeleton(keypoints) {
    const keypointColor = 'aqua';
    const lineColor = 'lime';

    // Draw all the keypoints (joints)
    for (const keypoint of keypoints) {
        if (keypoint.score > 0.3) { // Only draw confident keypoints
            ctx.beginPath();
            ctx.arc(keypoint.x, keypoint.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = keypointColor;
            ctx.fill();
        }
    }
    
    // Draw the lines connecting the joints
    const adjacentPairs = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
    ctx.beginPath();
    for (const [i, j] of adjacentPairs) {
        const kp1 = keypoints[i];
        const kp2 = keypoints[j];
        if (kp1.score > 0.3 && kp2.score > 0.3) {
            ctx.moveTo(kp1.x, kp1.y);
            ctx.lineTo(kp2.x, kp2.y);
        }
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = lineColor;
    ctx.stroke();
}


// Start the application!
main();