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
        return (await axios.get(METADATA_URL, {
            headers: {
                "Content-Type":"application/vnd.initializr.v2.3+json"
            }
        })).data;
    } catch (error) {
        console.error("Error fetching metadata:", error.message);
        throw error;
    }
}

function flattenDependencies(metadata) {
    const dependencies = [];
    if (metadata.dependencies && metadata.dependencies.values) {
        metadata.dependencies.values.forEach(group => {
            dependencies.push(...group.values.map(v => ({name: v.name, value: v.id})));
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
            default: metadata.javaVersion.default,
        }
    ];
    try{
        const basicAnswers = await inquirer.prompt(basicQuestions);
    
        const allDependenciesBySelectedBootVersion = new Set(Object.keys((await axios.get(`${BASE_URL}/dependencies?bootVersion=${basicAnswers.bootVersion}`, {
            headers: {
                "Content-Type": "application/vnd.initializr.v2.3+json"
            }
        })).data.dependencies));
        const allDependencies = flattenDependencies(metadata);
        const filteredDependencies = allDependencies.filter(d => allDependenciesBySelectedBootVersion.has(d.value));
        const selectedDependencies = await promptForDependencies(filteredDependencies);

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
    }catch(error){
        console.error('Failed to prompt user: ', error.message);
        throw error;
    }
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
        } else {
            console.log(`Project not extracted. You can manually extract '${zipFileName}'.`);
        }

    } catch (error) {
        console.error('Failed to generate project: ', error.message);
        throw error;   
    }
}

async function init() {
    try{
        const metadata = await fetchMetadata();
        const answers = await promptUser(metadata);
        await generateProject(answers);
    }catch(error){
        console.log("-----------------------")
        console.log("Report an issue at https://github.com/pankajjs/springjs/issues");
    }
}

init();