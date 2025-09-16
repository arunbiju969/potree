#!/usr/bin/env node

/**
 * Test script for FullPointCloudExporter
 * This script loads a Potree point cloud and exports it to LAS format
 */

import * as THREE from '../libs/three.js/build/three.module.js';
import { FullPointCloudExporter } from '../src/exporter/FullPointCloudExporter.js';
import { Potree } from '../src/Potree.js';

// Initialize Potree (simplified for testing)
global.Potree = {
    loadPointCloud: async (cloudjsPath) => {
        // This is a simplified loader for testing
        console.log(`Loading point cloud from: ${cloudjsPath}`);

        // In a real implementation, this would parse the cloud.js file
        // and load the point cloud data
        return {
            pointcloud: {
                name: 'test_pointcloud',
                position: new THREE.Vector3(0, 0, 0),
                root: null, // Would contain the octree root
                visibleNodes: [], // Would contain loaded nodes
                getAttribute: (name) => null
            }
        };
    }
};

async function testExport() {
    try {
        console.log('Testing FullPointCloudExporter...');

        // Load a test point cloud
        const result = await Potree.loadPointCloud('./pointclouds/lion_takanawa_las/cloud.js');
        const pointcloud = result.pointcloud;

        console.log(`Loaded point cloud: ${pointcloud.name}`);

        // Export to LAS
        console.log('Starting export...');
        const buffer = await FullPointCloudExporter.toLAS(pointcloud);

        console.log(`Export successful! Generated ${buffer.byteLength} bytes of LAS data`);

        // Save to file
        const fs = require('fs');
        fs.writeFileSync('test_export.las', Buffer.from(buffer));

        console.log('Test export saved as test_export.las');

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testExport();
