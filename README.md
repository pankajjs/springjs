# SpringJS CLI

A command-line interface tool to generate Spring Boot projects using Spring Initializr.

## Installation

### Global Installation (from npm - when published)

```bash
npm install -g springjs
```

### Local Installation (for development)

```bash
# Clone the repository
git clone <your-repo-url>
cd spring-cli

# Install dependencies
npm install

# Link globally for testing
npm link
```

## Usage

Simply run the command in your terminal:

```bash
springjs
```
## Publishing to npm

To publish this package to npm and make it available for everyone:

### Prerequisites

1. Create an npm account at [npmjs.com](https://www.npmjs.com/)
2. Login to npm from your terminal:

```bash
npm login
```

### Publishing Steps

1. **Check package name availability**:
   ```bash
   npm search springjs
   ```
   If the name is taken, update the `name` field in `package.json`

2. **Update version** (if republishing):
   ```bash
   npm version patch  # for bug fixes
   npm version minor  # for new features
   npm version major  # for breaking changes
   ```

3. **Publish to npm**:
   ```bash
   npm publish
   ```

4. **Verify publication**:
   ```bash
   npm view springjs
   ```