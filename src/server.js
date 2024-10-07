const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const { existsSync } = require("fs");

// Initialize Express app and set constants
const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.resolve(__dirname, "downloads");
const PUBLIC_PATH = path.join(__dirname, "..", "public");

console.log("Static directory:", PUBLIC_PATH);

// Middleware setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(PUBLIC_PATH));
app.use("/client", express.static(path.join(PUBLIC_PATH, "client")));

// Route handlers
app.get("/", (_, res) =>
  res.sendFile(path.resolve(PUBLIC_PATH, "client/index.html"))
);
app.post("/download", handleDownload);
app.get("/download/:filename", handleFileDownload);

// Start the server
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

/**
 * Handles the download request for YouTube videos
 * @param {Object} req.body - The request body
 * @throws {Error} If video ID is invalid or processing fails
 */
async function handleDownload(req, res) {
  try {
    const { videoId, startTime, endTime } = req.body;
    const extractedVideoId = extractVideoId(videoId);

    if (!extractedVideoId) throw new Error("Invalid YouTube Video ID or URL");

    const videoLength = await getVideoLength(extractedVideoId);
    console.log("Video length:", videoLength);
    validateTimes(startTime, endTime, videoLength);

    await ensureDownloadDirectory();
    const fullPath = path.resolve(
      DOWNLOAD_DIR,
      "%(id)s_%(resolution)s_trimmed.%(ext)s"
    );
    const ffmpegCommand = buildFfmpegCommand(startTime, endTime);

    await downloadAndTrimVideo(extractedVideoId, fullPath, ffmpegCommand);
    const downloadedFile = await findDownloadedFile(extractedVideoId);
    scheduleFileDeletion(downloadedFile);

    res.json({ status: "success", filename: downloadedFile });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    res.status(500).json({ status: "error", message: error.message });
  }
}

/**
 * Handles file download requests
 * @param {string} req.params.filename - The name of the file to download
 */
function handleFileDownload(req, res) {
  const { filename } = req.params;
  const filePath = path.resolve(DOWNLOAD_DIR, filename);

  if (existsSync(filePath)) {
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) {
        console.error(`Error downloading file: ${err}`);
        res
          .status(err.code === "ECONNABORTED" ? 408 : 500)
          .send(
            err.code === "ECONNABORTED"
              ? "Request timeout. Please try again."
              : "Error downloading file. Please try again."
          );
      }
    });
  } else {
    res.status(404).send("File not found");
  }
}

/**
 * Extracts YouTube video ID from various input formats
 * @param {string} input - YouTube video ID or URL
 * @returns {string|null} Extracted video ID or null if invalid
 */
function extractVideoId(input) {
  if (input.length === 11) return input;
  const match = input.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/
  );
  return match ? match[1].split("&")[0] : null;
}

/**
 * Ensures the download directory exists
 */
async function ensureDownloadDirectory() {
  if (!existsSync(DOWNLOAD_DIR)) {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  }
}

/**
 * Builds the FFmpeg command for video processing
 * @param {string} startTime - Start time for trimming
 * @param {string} endTime - End time for trimming
 * @returns {string} FFmpeg command string
 */
function buildFfmpegCommand(startTime, endTime) {
  const ffmpegArgs = [];
  if (startTime) ffmpegArgs.push(`-ss ${startTime}`);
  if (endTime) ffmpegArgs.push(`-to ${endTime}`);

  return ffmpegArgs.length > 0
    ? `${ffmpegArgs.join(
        " "
      )} -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k`
    : "-c:v copy -c:a copy";
}

/**
 * Downloads and trims the YouTube video
 * @param {string} videoId - YouTube video ID
 * @param {string} fullPath - Full path for the output file
 * @param {string} ffmpegCommand - FFmpeg command for processing
 */
function downloadAndTrimVideo(videoId, fullPath, ffmpegCommand) {
  return new Promise((resolve, reject) => {
    const download = spawn("yt-dlp", [
      "--format",
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "--postprocessor-args",
      `ffmpeg:${ffmpegCommand}`,
      "--merge-output-format",
      "mp4",
      "-o",
      fullPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    download.stdout.on("data", (chunk) =>
      console.log(`yt-dlp stdout: ${chunk}`)
    );
    download.stderr.on("data", (chunk) =>
      console.error(`yt-dlp stderr: ${chunk}`)
    );
    download.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`yt-dlp exited with code ${code}`))
    );
  });
}

/**
 * Finds the downloaded file in the download directory
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<string>} Filename of the downloaded file
 */
async function findDownloadedFile(videoId) {
  const files = await fs.readdir(DOWNLOAD_DIR);
  const downloadedFile = files.find(
    (file) => file.startsWith(videoId) && file.endsWith("_trimmed.mp4")
  );
  if (!downloadedFile)
    throw new Error(`Trimmed file not found for video ID: ${videoId}`);
  return downloadedFile;
}

/**
 * Schedules the deletion of the downloaded file
 * @param {string} filename - Name of the file to be deleted
 */
function scheduleFileDeletion(filename) {
  setTimeout(async () => {
    const filePath = path.resolve(DOWNLOAD_DIR, filename);
    try {
      const stats = await fs.stat(filePath);
      const fileAgeMins = (Date.now() - stats.mtime.getTime()) / 60000;
      if (fileAgeMins > 5) {
        await fs.unlink(filePath);
        console.log(`File ${filename} has been deleted.`);
      } else {
        console.log(`File ${filename} is still recent, skipping deletion.`);
      }
    } catch (error) {
      console.error(`Error handling file ${filename}:`, error);
    }
  }, 30000); // Check after 30 seconds
}

/**
 * Gets the length of a YouTube video
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<number>} Video length in seconds
 */
async function getVideoLength(videoId) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", [
      "--get-duration",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    let output = "";
    ytdlp.stdout.on("data", (data) => (output += data.toString()));
    ytdlp.stderr.on("data", (data) => console.error(`yt-dlp stderr: ${data}`));
    ytdlp.on("close", (code) =>
      code === 0
        ? resolve(parseDuration(output.trim()))
        : reject(new Error(`yt-dlp exited with code ${code}`))
    );
  });
}

/**
 * Parses duration string to seconds
 * @param {string} duration - Duration string
 * @returns {number} Duration in seconds
 */
function parseDuration(duration) {
  const parts = duration.split(":").map(Number);
  return parts.reduce(
    (acc, val, index) => acc + val * Math.pow(60, parts.length - index - 1),
    0
  );
}

/**
 * Validates start and end times against video length
 * @param {string} startTime - Start time for trimming
 * @param {string} endTime - End time for trimming
 * @param {number} videoLength - Total video length in seconds
 */
function validateTimes(startTime, endTime, videoLength) {
  const start = parseTimeToSeconds(startTime);
  const end = parseTimeToSeconds(endTime);

  if (start >= videoLength)
    throw new Error("Start time is longer than the video duration");
  if (end > videoLength)
    throw new Error("End time is longer than the video duration");
}

/**
 * Parses time string to seconds
 * @param {string} time - Time string
 * @returns {number} Time in seconds
 */
function parseTimeToSeconds(time) {
  if (!time) return 0;
  const parts = time.split(":").map(Number);
  return parts.reduce(
    (acc, val, index) => acc + val * Math.pow(60, parts.length - index - 1),
    0
  );
}

// Global error handler
app.use((err, _, res, __) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Request timeout middleware
app.use((_, res, next) => {
  res.setTimeout(300000, () => {
    if (!res.headersSent) {
      res.status(408).send("Request timeout. Please try again.");
    }
  });
  next();
});
