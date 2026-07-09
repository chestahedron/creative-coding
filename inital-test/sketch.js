function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
}

function draw() {
  background(17, 20);
  fill(255, 180, 80);
  circle(mouseX, mouseY, 48 + 12 * sin(frameCount * 0.1));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
