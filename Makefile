# Initialize the project by installing frontend dependencies
.PHONY: init
init:
	@echo "Initializing the project..."
	cd ui && npm install

# Build the frontend and backend
.PHONY: build
build: 
	@echo "Building the frontend and backend..."
	cd ui && npm run build
	go build .

# Run the web app (build frontend, then run backend)
.PHONY: start
start:
	@echo "Starting the web app..."
	cd ui && npm run build
	go run .

# Default target: run both frontend and backend in development
.PHONY: dev
dev:
	@echo "Starting the frontend and backend in development..."
	(cd ui && npm start) & go run .

# Package the Electron app
.PHONY: electron-package
electron-package:
	@echo "Packaging the Electron app..."
	go build -o ./ui/build/zasper
	cd ui && npm run electron-package
