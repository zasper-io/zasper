# Contributing to Zasper

Thank you for considering contributing to Zasper! We appreciate your interest in improving the project. Whether you're fixing a bug, adding a feature, or improving documentation, your contributions help make Zasper better for everyone.

This document will guide you through the process of contributing to the project.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Submitting Code](#submitting-code)
  - [Creating Documentation](#creating-documentation)
- [Development Setup](#development-setup)
- [Style Guidelines](#style-guidelines)
- [Testing](#testing)
- [Commit Messages](#commit-messages)

## Code of Conduct

By contributing to Zasper, you agree to abide by the [Code of Conduct](https://github.com/zasper-io/zasper/blob/main/CODE_OF_CONDUCT.md). Please make sure your interactions are respectful and constructive.

## How to Contribute

We welcome contributions to Zasper! There are several ways you can contribute:

### Reporting Bugs

If you've encountered a bug in Zasper, we appreciate you reporting it. Here's how to do that:
1. **Search for Existing Issues**: Before reporting a new bug, please check the [issues](https://github.com/zasper-io/zasper/issues) to see if it has already been reported.
2. **Create a New Issue**: If your bug has not been reported yet, please create a new issue. Be sure to provide as much detail as possible:
   - Steps to reproduce the bug
   - Expected behavior
   - Actual behavior
   - Any error messages or logs

### Suggesting Features

We are always open to new ideas and features. If you have an idea that you think will improve Zasper, please:
1. **Search for Existing Feature Requests**: Ensure your feature isn't already suggested.
2. **Create a New Feature Request**: If not, open a new issue with a description of the feature and why it would be valuable.

### Submitting Code

We welcome code contributions! Here’s how you can submit your changes:
1. **Fork the Repository**: Create a fork of the repository on GitHub.
2. **Clone Your Fork**: Clone your fork to your local machine using the following command:
    ```bash
    git clone https://github.com/your-username/zasper.git
    ```
3. Create a Branch: Create a branch for your work:
    ```bash
    git checkout -b feature-branch
    ```
4. Make Changes: Implement your changes in the codebase.
5. Commit Changes: Once you're happy with your changes, commit them with a clear and concise message.
    ```bash
    git commit -m "Add [feature/bugfix] to [file]"
    ```
5. Push to Your Fork: Push your changes to your fork:
```bash
git push origin feature-branch
```
6. Create a Pull Request: Go to the repository and create a pull request. Provide a detailed description of your changes and why they are needed.

### Creating Documentation

Improving documentation is just as important as improving the code! If you find any documentation that needs to be clarified or updated, feel free to make a pull request with your improvements.

### Development Setup

To get started with development, you'll need to set up your local environment.

### **Clone the Repository**
    
```bash
git clone https://github.com/zasper-io/zasper.git
```


### **Initialize the project**

This command installs all the necessary frontend dependencies (via `npm install`).

```bash
make init
```

### 2. **Build the frontend and backend**

This command builds both the frontend (via `npm run build` in the ui directory) and the backend (via `go build` in the root directory).

```bash
make build
```

### 3. **Start the web app (development mode)**

This command starts both the frontend and the backend simultaneously in development mode. The frontend runs via `npm start` and the backend via `go run .`

```bash
make dev
```
This is especially useful when you are working on the project and want to run both the frontend and backend concurrently.

### 3. **Start the Electron app (development mode)**

This command starts both the frontend and the backend simultaneously in development mode. The frontend runs via `npm run electron-dev` and the backend via `go run .`

```bash
make electron-dev
```

This is especially useful when you are working on the project and want to run both the frontend and backend concurrently.

### 5. **Package the Desktop app**

This command builds the Electron app and packages it using the `npm run electron-package` script in the `ui` directory. The backend is also compiled with `go build`.

```bash
make electron-package
```
This will create a packaged Electron app inside the `ui/build/dist` directory.

### 6. **Package and Install the Web App**

This command builds creates a binary `zasper` and add it to your go executables directory. Make sure you have go executables on your path. 

```bash
make webapp-install
```


### Style Guidelines
Please follow these code style guidelines when contributing:

* Follow the existing coding style of the project (indentation, variable naming, etc.)
* Use descriptive variable and function names
* Ensure that your code is readable and maintainable

If there are any specific style guidelines for the project, such as ESLint or PEP8, please refer to the project’s configuration files.

### Testing

Please ensure that your changes are covered by tests. If the project includes a test suite, you can run it to verify your changes.

1. Write Tests: If your contribution involves code changes, write appropriate tests to cover your changes.
2. Run Tests: Run the existing test suite to ensure that everything works correctly.

### Commit Messages
We encourage clear and concise commit messages. Please follow this format for your commit messages:

```
<type>: <subject>

<body>
```
Where:

* <type> is one of the following: feat (new feature), fix (bug fix), docs (documentation), style (code style changes), refactor (code refactoring), test (adding or modifying tests), chore (maintenance tasks).
* <subject> is a short description of what was done.
* <body> (optional) provides further context, if necessary.

Example:
```
feat: add notebook kernel switcher

Added kernel switcher ui and backend to allow kernel change on the fly.
```
Thank you again for your interest in contributing to Zasper! We look forward to working with you.
