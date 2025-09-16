import * as THREE from "../../libs/three.js/build/three.module.js";
import {LASExporter} from "./LASExporter.js";
import {Points} from "../Points.js";

/**
 * Full Point Cloud Exporter for Potree
 * Exports entire point clouds from Potree format to LAS
 */
export class FullPointCloudExporter {

	/**
	 * Export entire point cloud to LAS format
	 * @param {PointCloudOctree} pointcloud - The Potree point cloud to export
	 * @returns {ArrayBuffer} LAS file buffer
	 */
	static async toLAS(pointcloud) {
		console.log("Starting full point cloud export...");

		const points = await this.extractAllPoints(pointcloud);

		if (points.numPoints === 0) {
			throw new Error("No points found in point cloud");
		}

		console.log(`Extracted ${points.numPoints} points for export`);

		// Use existing LASExporter with the collected points
		return LASExporter.toLAS(points);
	}

	/**
	 * Extract all points from a Potree point cloud
	 * @param {PointCloudOctree} pointcloud - The point cloud to extract from
	 * @returns {Promise<Points>} Points object containing all point data
	 */
	static async extractAllPoints(pointcloud) {
		const points = new Points();

		// Get all visible nodes (this will load all data)
		const visibleNodes = pointcloud.visibleNodes || [];

		// If no visible nodes, we need to traverse the octree
		if (visibleNodes.length === 0) {
			await this.traverseOctree(pointcloud.root, points, pointcloud);
		} else {
			// Extract from visible nodes
			for (const node of visibleNodes) {
				if (node.geometry && node.geometry.attributes) {
					this.extractPointsFromNode(node, points, pointcloud);
				}
			}
		}

		return points;
	}

	/**
	 * Traverse the octree to collect all points
	 * @param {PointCloudOctreeNode} node - Current octree node
	 * @param {Points} points - Points collection to add to
	 * @param {PointCloudOctree} pointcloud - The parent point cloud
	 */
	static async traverseOctree(node, points, pointcloud) {
		// Load node data if not already loaded
		if (!node.loaded) {
			await new Promise((resolve) => {
				node.load().then(() => resolve());
			});
		}

		// Extract points from this node
		if (node.geometry && node.geometry.attributes) {
			this.extractPointsFromNode(node, points, pointcloud);
		}

		// Recursively traverse children
		for (const child of node.children) {
			if (child) {
				await this.traverseOctree(child, points, pointcloud);
			}
		}
	}

	/**
	 * Extract points from a single octree node
	 * @param {PointCloudOctreeNode} node - The node to extract from
	 * @param {Points} points - Points collection to add to
	 * @param {PointCloudOctree} pointcloud - The parent point cloud
	 */
	static extractPointsFromNode(node, points, pointcloud) {
		const geometry = node.geometry;
		const numPoints = geometry.attributes.position.count;

		if (numPoints === 0) return;

		// Create point data structure similar to profile extraction
		const pointData = {
			position: new Float32Array(numPoints * 3),
			numPoints: numPoints
		};

		// Extract position data
		const positions = geometry.attributes.position.array;
		const nodeOffset = node.boundingBox.min;

		for (let i = 0; i < numPoints; i++) {
			// Apply node offset and point cloud position
			pointData.position[i * 3 + 0] = positions[i * 3 + 0] + nodeOffset.x + pointcloud.position.x;
			pointData.position[i * 3 + 1] = positions[i * 3 + 1] + nodeOffset.y + pointcloud.position.y;
			pointData.position[i * 3 + 2] = positions[i * 3 + 2] + nodeOffset.z + pointcloud.position.z;
		}

		// Extract other attributes if available
		if (geometry.attributes.intensity) {
			pointData.intensity = new Uint16Array(geometry.attributes.intensity.array);
		}

		if (geometry.attributes.classification) {
			pointData.classification = new Uint8Array(geometry.attributes.classification.array);
		}

		if (geometry.attributes.returnNumber) {
			pointData.returnNumber = new Uint8Array(geometry.attributes.returnNumber.array);
		}

		if (geometry.attributes.numberOfReturns) {
			pointData.numberOfReturns = new Uint8Array(geometry.attributes.numberOfReturns.array);
		}

		if (geometry.attributes.pointSourceID) {
			pointData.pointSourceID = new Uint16Array(geometry.attributes.pointSourceID.array);
		}

		// Handle color data (rgba or color)
		if (geometry.attributes.rgba) {
			pointData.rgba = new Uint8Array(geometry.attributes.rgba.array);
		} else if (geometry.attributes.color) {
			pointData.color = new Uint8Array(geometry.attributes.color.array);
		}

		// Create bounding box for this point set
		const boundingBox = new THREE.Box3();
		for (let i = 0; i < numPoints; i++) {
			const point = new THREE.Vector3(
				pointData.position[i * 3 + 0],
				pointData.position[i * 3 + 1],
				pointData.position[i * 3 + 2]
			);
			boundingBox.expandByPoint(point);
		}

		// Add to points collection
		points.add({
			data: pointData,
			numPoints: numPoints,
			boundingBox: boundingBox
		});
	}

	/**
	 * Download the exported LAS file
	 * @param {PointCloudOctree} pointcloud - The point cloud to export
	 * @param {string} filename - Optional filename (defaults to pointcloud name)
	 */
	static async downloadLAS(pointcloud, filename = null) {
		try {
			const buffer = await this.toLAS(pointcloud);

			if (!filename) {
				filename = `${pointcloud.name || 'pointcloud'}.las`;
			}

			const blob = new Blob([buffer], { type: 'application/octet-binary' });
			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);

			URL.revokeObjectURL(url);

			console.log(`Downloaded ${filename} (${buffer.byteLength} bytes)`);
		} catch (error) {
			console.error('Export failed:', error);
			throw error;
		}
	}
}
