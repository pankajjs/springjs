#! /usr/bin/env node

import inquirer from 'inquirer';
import axios from 'axios';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import inquirerSearchList from 'inquirer-search-list';
import inquirerCheckboxPlusPrompt from 'inquirer-checkbox-plus-prompt';

const BASE_URL = "https://start.spring.io";
const METADATA_URL = `${BASE_URL}/metadata/client`;

inquirer.registerPrompt('search-list', inquirerSearchList);
inquirer.registerPrompt('checkbox-plus', inquirerCheckboxPlusPrompt);

async function fetchMetadata() {
    try {
        const response = await axios.get(METADATA_URL);
        return response.data;
    } catch (error) {
        console.error("Error fetching metadata from Spring Initializr:", error.message);
        process.exit(1);
    }
}

function parseVersion(version) {
    const parts = version.split(/[-.]/);
    const numericParts = [];
    let qualifier = null;

    for (const part of parts) {
        if (/^\d+$/.test(part)) {
            numericParts.push(parseInt(part, 10));
        } else {
            qualifier = part;
            break;
        }
    }
    while (numericParts.length < 3) {
        numericParts.push(0);
    }
    return { major: numericParts[0], minor: numericParts[1], patch: numericParts[2], qualifier: qualifier || '' };
}

function compareVersions(v1, v2) {
    if (v1.major !== v2.major) return v1.major - v2.major;
    if (v1.minor !== v2.minor) return v1.minor - v2.minor;
    if (v1.patch !== v2.patch) return v1.patch - v2.patch;
    
    // Qualifier comparison
    const getQualifierRank = (q) => {
        if (!q || q === 'RELEASE') return 4;
        if (q.startsWith('RC')) return 3;
        if (q.startsWith('M')) return 2;
        if (q.includes('SNAPSHOT')) return 1;
        return 0; // Unknown/other
    };

    const r1 = getQualifierRank(v1.qualifier);
    const r2 = getQualifierRank(v2.qualifier);

    if (r1 !== r2) return r1 - r2;

    // If ranks are same (e.g. both RC or both Snapshot), compare strings
    // But for Release/Empty (rank 4), they are equal
    if (r1 === 4) return 0;
    
    // For M1 vs M2, RC1 vs RC2
    return v1.qualifier.localeCompare(v2.qualifier);
}

function checkRange(versionStr, rangeStr) {
    if (!rangeStr) return true; // No range specified, implies valid

    const version = parseVersion(versionStr);
    
    // Spring ranges: e.g., "[3.0.0, 4.0.0)", "3.1.0" (starting from), etc.
    // Simple parsing for bracket/paren notation
    const rangeDetails = rangeStr.trim();
    
    let start, end, startInclusive, endInclusive;

    // Check strict range first
    if ((rangeDetails.startsWith('[') || rangeDetails.startsWith('(')) && 
        (rangeDetails.endsWith(']') || rangeDetails.endsWith(')'))) {
            
        const parts = rangeDetails.split(',');
        if (parts.length === 2) {
            startInclusive = rangeDetails.startsWith('[');
            endInclusive = rangeDetails.endsWith(']');
            
            start = parts[0].slice(1).trim();
            end = parts[1].slice(0, -1).trim();
        } else {
            // Unexpected format, assume valid
            return true;
        }
    } else {
        // "3.1.0" means >= 3.1.0
        start = rangeDetails;
        startInclusive = true;
        end = null;
    }

    if (start) {
        const startVer = parseVersion(start);
        const comp = compareVersions(version, startVer);
        if (startInclusive && comp < 0) return false;
        if (!startInclusive && comp <= 0) return false;
    }

    if (end) {
        const endVer = parseVersion(end);
        const comp = compareVersions(version, endVer);
        if (endInclusive && comp > 0) return false;
        if (!endInclusive && comp >= 0) return false;
    }

    return true;
}

function flattenDependencies(metadata, bootVersion) {
    //  filter dependencies by compatible versionRange
    const dependencies = [];
    if (metadata.dependencies && metadata.dependencies.values) {
        metadata.dependencies.values.forEach(group => {
           dependencies.push(...group.values.map(v => ({name: v.name, value: v.id, versionRange: v.versionRange})));
        });
    }
    return dependencies;
}

async function promptForDependencies(allDependencies) {
    const {dependencies} = await inquirer.prompt([
        {
            type: 'checkbox-plus',
            name: 'dependencies',
            message: 'Select dependencies (type to search, space to select, enter to finish):',
            highlight: true,
            searchable: true,
            default: [], 
            source: function(answersSoFar, input) {
                input = input || '';
                return new Promise((resolve) => {
                    const filteredDependencies = allDependencies.filter(dep =>
                        dep.name.toLowerCase().includes(input.toLowerCase())
                    );
                    resolve(filteredDependencies);
                });
            },
        }
    ]);

    return dependencies;
}

async function promptUser(metadata) {
    const basicQuestions = [
        {
            type: 'list',
            name: 'type',
            message: 'Select project type:',
            choices: metadata.type.values.filter(v=> v.tags.format === "project").map(v => ({ name: v.name, value: v.id })),
            default: metadata.type.default
        },
        {
            type: 'list',
            name: 'language',
            message: 'Select language:',
            choices: metadata.language.values.map(v => ({ name: v.name, value: v.id })),
            default: metadata.language.default
        },
        {
            type: 'list',
            name: 'bootVersion',
            message: 'Select Spring Boot version:',
            choices: metadata.bootVersion.values.map(v => {
                if (v.id.endsWith('.BUILD-SNAPSHOT')) {
                    v.id = v.id.replace('.BUILD-SNAPSHOT', '-SNAPSHOT');
                } else if (v.id.endsWith('.RELEASE')) {
                    v.id = v.id.replace('.RELEASE', '');
                }
                return { name: v.name, value: v.id };
            }),
            default: metadata.bootVersion.default.endsWith("RELEASE") ? metadata.bootVersion.default.replace(".RELEASE", "") : metadata.bootVersion.default
        },
        {
            type: 'input',
            name: 'groupId',
            message: 'Group:',
            default: metadata.groupId.default
        },
        {
            type: 'input',
            name: 'artifactId',
            message: 'Artifact:',
            default: metadata.artifactId.default
        },
        {
            type: 'input',
            name: 'name',
            message: 'Name:',
            default: (answers) => answers.artifactId
        },
        {
            type: 'input',
            name: 'description',
            message: 'Description:',
            default: metadata.description.default
        },
        {
            type: 'input',
            name: 'packageName',
            message: 'Package name:',
            default: (answers) => `${answers.groupId}.${answers.artifactId}`
        },
        {
            type: 'list',
            name: 'packaging',
            message: 'Packaging:',
            choices: metadata.packaging.values.map(v => ({ name: v.name, value: v.id })),
            default: metadata.packaging.default
        },
		{
			type: "list",
			name: "configurationFileFormat",
			message: "Configuration:",
			default: "properties",
			choices: [{name: "Properties", value: "properties"}, {name: "Yaml", value: "yaml"}]
		},
        {
            type: 'list',
            name: 'javaVersion',
            message: 'Java:',
            choices: metadata.javaVersion.values.map(v => ({ name: v.name, value: v.id })),
            default: metadata.javaVersion.default
        }
    ];

    const basicAnswers = await inquirer.prompt(basicQuestions);
    const allDependencies = flattenDependencies(metadata, basicAnswers.bootVersion);
    const selectedDependencies = await promptForDependencies(allDependencies);

    basicAnswers.dependencies = selectedDependencies;

    const { extractProject } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'extractProject',
            message: 'Do you want to extract the project after downloading?',
            default: true
        }
    ]);
    
    basicAnswers.extractProject = extractProject;

    return basicAnswers;
}

async function generateProject(answers) {
    const params = new URLSearchParams();
    
    params.append('type', answers.type);
    params.append('language', answers.language);
    params.append('bootVersion', answers.bootVersion);
    params.append('baseDir', answers.artifactId); 
    params.append('groupId', answers.groupId);
    params.append('artifactId', answers.artifactId);
    params.append('name', answers.name);
    params.append('description', answers.description);
    params.append('packageName', answers.packageName);
    params.append('packaging', answers.packaging);
    params.append('javaVersion', answers.javaVersion);
    
    if (answers.dependencies && answers.dependencies.length > 0) {
        params.append('dependencies', answers.dependencies.join(','));
    }

    const downloadUrl = `${BASE_URL}/starter.zip?${params.toString()}`;
    
    try {
        const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer' 
        });

        const outputDir = process.cwd();
        const zipFileName = `${answers.artifactId}.zip`;
        const zipFilePath = path.join(outputDir, zipFileName);

        fs.writeFileSync(zipFilePath, response.data);

        if (answers.extractProject) {
            const zip = new AdmZip(zipFilePath);
            zip.extractAllTo(outputDir, true);
            console.log(`Project extracted successfully to: ${path.join(outputDir, answers.artifactId)}`);

            fs.unlinkSync(zipFilePath);
            console.log(`Zip file removed.`);
        } else {
            console.log(`Project not extracted. You can manually extract '${zipFileName}'.`);
        }

    } catch (error) {
        console.error('Error generating project:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            try {
                console.error(error.response.data.toString());
            } catch (e) {}
        } else {
            console.error(error.message);
        }
    }
}

async function init() {
    console.log('Fetching project metadata...');
    const metadata = await fetchMetadata();
    const answers = await promptUser(metadata);
    await generateProject(answers);
}

init();