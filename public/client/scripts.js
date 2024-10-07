// DOM Elements
const statusModal = document.getElementById("statusModal");
const infoModal = document.getElementById("infoModal");
const startTimeInput = document.getElementById("startTime");
const endTimeInput = document.getElementById("endTime");
const downloadMessage = document.getElementById("downloadMessage");
const downloadButton = document.getElementById("downloadButton");
const ellipsis = document.getElementById("ellipsis");

let ellipsisInterval;

/**
 * Animates an ellipsis for loading states
 */
function animateEllipsis() {
  let dots = 0;
  clearInterval(ellipsisInterval);
  ellipsisInterval = setInterval(() => {
    ellipsis.textContent = ".".repeat(dots);
    dots = (dots + 1) % 4;
  }, 500);
}

/**
 * Stops the ellipsis animation
 */
function stopEllipsisAnimation() {
  clearInterval(ellipsisInterval);
  ellipsis.textContent = "";
}

/**
 * Displays a modal
 * @param {HTMLElement} modal - The modal to show
 */
function showModal(modal) {
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

/**
 * Hides a modal
 * @param {HTMLElement} modal - The modal to hide
 */
function hideModal(modal) {
  modal.classList.remove("flex");
  modal.classList.add("hidden");
}

/**
 * Displays a status modal with a message
 * @param {string} message - The message to display
 */
function showStatusModal(message) {
  downloadMessage.textContent = message;
  showModal(statusModal);
  if (
    message.toLowerCase().includes("processing") ||
    message.toLowerCase().includes("downloading")
  ) {
    animateEllipsis();
  } else {
    stopEllipsisAnimation();
  }
}

function hideStatusModal() {
  hideModal(statusModal);
  stopEllipsisAnimation();
}

function hideInfoModal() {
  hideModal(infoModal);
}

/**
 * Handle outside click for modals
 * @param {Event} event - The click event
 * @param {HTMLElement} modal - The modal element
 * @param {Function} hideFunction - The function to hide the modal
 */
function handleOutsideClick(event, modal, hideFunction) {
  if (event.target === modal) {
    const currentMessage = downloadMessage.textContent.trim().toLowerCase();
    if (
      currentMessage !== "Idle" ||
      currentMessage !== "Error: Invalid YouTube Video ID or URL" ||
      currentMessage !==
        "Error: Start time is longer than the video duration" ||
      currentMessage !== "Error: End time is longer than the video duration"
    ) {
      hideFunction();
    }
  }
}

/**
 * Updates the download button text
 */
function updateDownloadButtonText() {
  if (startTimeInput.value.trim() || endTimeInput.value.trim()) {
    downloadButton.textContent = "Download and Trim";
  } else {
    downloadButton.textContent = "Download";
  }
}

// Event listeners
statusModal.addEventListener("click", (event) =>
  handleOutsideClick(event, statusModal, hideStatusModal)
);

infoModal.addEventListener("click", (event) =>
  handleOutsideClick(event, infoModal, hideInfoModal)
);

/**
 * Handles the download button click event
 */
downloadButton.addEventListener("click", function () {
  showStatusModal("Processing the video");

  const videoIdInput = document.getElementById("videoId");

  fetch("/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoId: videoIdInput.value,
      startTime: startTimeInput.value,
      endTime: endTimeInput.value,
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "success") {
        showStatusModal("Processing complete. Initiating download");
        setTimeout(() => {
          const link = document.createElement("a");
          link.href = "/download/" + data.filename;
          link.download = data.filename;
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => {
            showStatusModal("Thanks for using YouTrim!");
          }, 4500);
        }, 3000);
        updateDownloadButtonText();
      } else {
        showStatusModal("Error: " + data.message);
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      showStatusModal("An error occurred. Please try again.");
    });

  // Clear input fields
  videoIdInput.value = "";
  startTimeInput.value = "";
  endTimeInput.value = "";
});

document.getElementById("infoButton").addEventListener("click", function () {
  showModal(infoModal);
});

startTimeInput.addEventListener("input", updateDownloadButtonText);
endTimeInput.addEventListener("input", updateDownloadButtonText);

// Initial call to set the correct text when the page loads
updateDownloadButtonText();
