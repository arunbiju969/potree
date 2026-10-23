
import * as THREE from "../../libs/three.js/build/three.module.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";

/**
 * InspectionTool
 *
 * A picking tool in the style of the measurement tools: while it is active, the
 * closest point under the mouse cursor is highlighted and a readout panel in the
 * lower right corner is updated continuously with the attributes of that point
 * (position, rgb, intensity, classification, gps-time, ... and any custom scalar
 * field such as a semantic segmentation class).
 *
 * A click pins the current point: the readout stops following the mouse until it
 * is unpinned (click again, click on empty space, or click the 'pinned' badge).
 *
 * Picking uses Potree's GPU picking (PointCloudOctree.pick()), so the reported
 * values are the original values from the point cloud: PointCloudOctree.pick()
 * inverts the decoder workers normalisation (attribute.potree.scale/offset).
 */
export class InspectionTool extends EventDispatcher{
	constructor(viewer){
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;

		this.active = false;
		this.lastHoverPick = 0;
		this.hoverPick = null;
		this.pinnedPick = null;
		this.pointerDown = null;

		// MARKER, marks the inspected point in the scene.
		// Like the measurement markers, the marker keeps a constant size on screen.
		// It is a small dot on the point, surrounded by a ring, so that the exact
		// point that is going to be picked stays visible.
		let markerMaterial = new THREE.MeshBasicMaterial({
			color: 0xffcc33,
			transparent: true,
			opacity: 0.95,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
		});

		this.marker = new THREE.Group();
		this.marker.name = "inspection_marker";
		this.marker.visible = false;
		this.marker.renderOrder = 1000;

		this.markerDot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), markerMaterial);
		this.markerDot.renderOrder = 1000;

		this.markerRing = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.85, 32), markerMaterial);
		this.markerRing.renderOrder = 1000;

		// size of the marker in pixels (radius)
		this.markerDotPixels = 2.5;
		this.markerRingPixels = 11;

		this.tmpQuaternion = new THREE.Quaternion();

		this.marker.add(this.markerDot);
		this.marker.add(this.markerRing);

		viewer.scene.scene.add(this.marker);

		// PANEL, the readout in the bottom right corner
		this.panel = null;
		this.pinned = false;
		this.lastPick = null;

		// EVENTS
		this.onPointerMove = this.onPointerMove.bind(this);
		this.onPointerDown = this.onPointerDown.bind(this);
		this.onPointerUp = this.onPointerUp.bind(this);
		this.onKeyDown = this.onKeyDown.bind(this);
		this.onUpdate = this.onUpdate.bind(this);
		this.onCancelInsertions = this.deactivate.bind(this);

		viewer.addEventListener('cancel_insertions', this.onCancelInsertions);
		viewer.addEventListener('update', this.onUpdate);
	}

	// ------------------------------------------------------------------
	// activation
	// ------------------------------------------------------------------

	isActive(){
		return this.active;
	}

	activate(){
		if(this.active){
			return;
		}

		// stop the other tools first: they dispatch 'cancel_insertions', which is
		// also handled by this tool (this.active is still false, so it is a no-op).
		this.viewer.dispatchEvent({type: 'cancel_insertions'});
		this.viewer.dispatchEvent({type: 'inspection_tool_started'});

		this.active = true;

		let domElement = this.renderer.domElement;
		domElement.style.cursor = 'crosshair';
		domElement.addEventListener('pointermove', this.onPointerMove, true);
		domElement.addEventListener('pointerdown', this.onPointerDown, true);
		domElement.addEventListener('pointerup', this.onPointerUp, true);
		document.addEventListener('keydown', this.onKeyDown, true);

		this.viewer.postMessage(
			`Inspect: the attributes of the point under the mouse are shown in the panel ` +
			`in the lower right. Click a point to pin it, right click or ESC to exit.`,
			{duration: 6000});

		this.ensurePanel();
		this.updatePanel(null);

		this.dispatchEvent({type: 'started'});
	}

	deactivate(){
		let wasActive = this.active;
		this.active = false;

		let domElement = this.renderer.domElement;
		domElement.style.cursor = 'default';
		domElement.removeEventListener('pointermove', this.onPointerMove, true);
		domElement.removeEventListener('pointerdown', this.onPointerDown, true);
		domElement.removeEventListener('pointerup', this.onPointerUp, true);
		document.removeEventListener('keydown', this.onKeyDown, true);

		this.marker.visible = false;
		this.hoverPick = null;
		this.pinnedPick = null;
		this.pointerDown = null;
		this.pinned = false;
		this.lastPick = null;

		this.hidePanel();

		if(wasActive){
			this.dispatchEvent({type: 'stopped'});
		}
	}

	toggle(){
		if(this.active){
			this.deactivate();
		}else{
			this.activate();
		}
	}

	// ------------------------------------------------------------------
	// interaction
	// ------------------------------------------------------------------

	onKeyDown(e){
		if(!this.active){
			return;
		}

		if(e.key === 'Escape' || e.key === 'Esc'){
			e.preventDefault();
			this.deactivate();
		}
	}

	onPointerDown(e){
		if(!this.active){
			return;
		}

		this.pointerDown = {x: e.offsetX, y: e.offsetY, button: e.button};

		if(e.button === THREE.MOUSE.RIGHT){
			this.deactivate();
		}
	}

	onPointerMove(e){
		if(!this.active){
			return;
		}

		// GPU picking is not free: throttle the hover highlight
		let now = performance.now();

		if(now - this.lastHoverPick < 40){
			return;
		}

		this.lastHoverPick = now;

		let pick = this.pickAt(e.offsetX, e.offsetY);
		this.hoverPick = pick;

		if(this.pinned){
			// the readout is frozen on the pinned point
			return;
		}

		if(pick){
			this.setMarker(pick);
		}else{
			this.marker.visible = false;
		}

		this.updatePanel(pick);
	}

	onPointerUp(e){
		if(!this.active || this.pointerDown === null){
			return;
		}

		let down = this.pointerDown;
		this.pointerDown = null;

		if(e.button !== THREE.MOUSE.LEFT){
			return;
		}

		// ignore clicks that were used to orbit/pan the scene
		let dx = e.offsetX - down.x;
		let dy = e.offsetY - down.y;

		if(Math.sqrt(dx * dx + dy * dy) > 6){
			return;
		}

		// the readout follows the mouse continuously; a click pins/unpins it
		let pick = this.pickAt(e.offsetX, e.offsetY);

		if(!pick){
			// clicking on empty space releases the pin
			this.pinned = false;
			this.pinnedPick = null;
			this.updatePanel(this.hoverPick);

			return;
		}

		this.pinned = !this.pinned;
		this.pinnedPick = this.pinned ? pick : null;

		if(this.pinned){
			this.setMarker(pick);
		}

		this.updatePanel(pick);
	}

	pickAt(x, y){
		let camera = this.viewer.scene.getActiveCamera();

		return Utils.getMousePointCloudIntersection(
			{x: x, y: y},
			camera,
			this.viewer,
			this.viewer.scene.pointclouds,
			{pickClipped: true});
	}

	setMarker(pick){
		let scene = this.viewer.scene.scene;

		if(this.marker.parent !== scene){
			// the marker has to be re-added when the scene has been switched
			scene.add(this.marker);
		}

		this.marker.position.copy(pick.location);
		this.marker.visible = true;

		this.updateMarker();
	}

	/**
	 * Keeps the marker at a constant size on screen, like the measurement markers,
	 * and turns the ring into a billboard that faces the camera.
	 */
	updateMarker(){
		if(!this.marker.visible){
			return;
		}

		let camera = this.viewer.scene.getActiveCamera();
		let size = this.renderer.getSize(new THREE.Vector2());
		let distance = camera.position.distanceTo(this.marker.position);
		let pr = Utils.projectedRadius(1, camera, distance, size.width, size.height);

		if(!Number.isFinite(pr) || pr <= 0){
			return;
		}

		this.markerDot.scale.setScalar(this.markerDotPixels / pr);
		this.markerRing.scale.setScalar(this.markerRingPixels / pr);

		camera.getWorldQuaternion(this.tmpQuaternion);
		this.markerRing.quaternion.copy(this.tmpQuaternion);
	}

	// ------------------------------------------------------------------
	// readout panel, docked in the lower right corner of the render area
	// ------------------------------------------------------------------

	ensurePanel(){
		if(this.panel !== null){
			return this.panel;
		}

		let container = this.renderer.domElement.parentElement;

		this.panel = $(`
			<div class="potree-inspect-panel"
				style="position: absolute;
					right: 16px;
					bottom: 16px;
					z-index: 10000;
					min-width: 250px;
					max-width: 340px;
					max-height: 62vh;
					display: flex;
					flex-direction: column;
					background: rgba(28, 30, 36, 0.94);
					border: 1px solid rgba(255, 255, 255, 0.25);
					border-radius: 6px;
					box-shadow: 0px 4px 18px rgba(0, 0, 0, 0.6);
					color: #eee;
					font-size: 12px;
					font-family: 'Open Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
					pointer-events: auto;
					user-select: text;
				">
				<div class="potree-inspect-header"
					style="display: flex; align-items: center; gap: 6px;
							padding: 6px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.18);
							background: rgba(255, 255, 255, 0.06); border-radius: 6px 6px 0px 0px;">
					<span class="potree-inspect-title"
						style="flex-grow: 1; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
					<span class="potree-inspect-pin" title="Click to unpin"
						style="flex: 0 0 auto; display: none; font-size: 10px; padding: 1px 6px; border-radius: 8px;"></span>
					<img class="potree-inspect-close" src="${Potree.resourcePath}/icons/close.svg"
						title="Close"
						style="width: 16px; height: 16px; opacity: 0.7; cursor: pointer;" />
				</div>
				<div class="potree-inspect-rows"
					style="padding: 4px 8px 6px 8px; overflow-y: auto;"></div>
				<div class="potree-inspect-footer"
					style="display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid rgba(255, 255, 255, 0.18);">
					<button type="button" class="potree-inspect-copy"
						style="flex-grow: 1; padding: 3px 6px; font-size: 11px; cursor: pointer;
								background: rgba(255, 255, 255, 0.1); color: #eee;
								border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 3px;">Copy</button>
				</div>
			</div>
		`);

		this.panel.find('.potree-inspect-close').click(() => this.deactivate());

		this.panel.find('.potree-inspect-pin').click(() => {
			this.pinned = false;
			this.pinnedPick = null;
			this.updatePanel(this.hoverPick);
		});

		this.panel.find('.potree-inspect-copy').click((e) => {
			if(this.lastPick === null){
				return;
			}

			this.copyToClipboard(this.createText(this.lastPick));

			let el = $(e.currentTarget);
			el.text('Copied');
			setTimeout(() => el.text('Copy'), 1200);
		});

		// don't navigate the camera when interacting with the panel
		this.panel.on('pointerdown', (e) => e.stopPropagation());
		this.panel.on('pointerup', (e) => e.stopPropagation());
		this.panel.on('wheel', (e) => e.stopPropagation());

		container.appendChild(this.panel[0]);

		return this.panel;
	}

	/**
	 * Fills the readout with the attributes of the given point.
	 * Called on every (throttled) hover pick, and on pin/unpin.
	 */
	updatePanel(pick){
		this.ensurePanel();

		let elTitle = this.panel.find('.potree-inspect-title');
		let elRows = this.panel.find('.potree-inspect-rows');
		let elPin = this.panel.find('.potree-inspect-pin');

		elRows.empty();

		if(pick === null || pick === undefined){
			this.lastPick = null;
			elTitle.text('No point under the mouse');
			elRows.append($(`
				<div style="color: #999; padding: 4px 0px;">Move the mouse over the point cloud.</div>
			`));
		}else{
			this.lastPick = pick;
			elTitle.text(pick.pointcloud.name || 'Point cloud');

			for(let row of this.createRows(pick)){
				elRows.append(row.element);
			}
		}

		if(this.pinned){
			elPin.text('pinned').css({
				display: 'inline-block',
				background: 'rgba(255, 204, 51, 0.25)',
				color: '#ffcc33',
				border: '1px solid rgba(255, 204, 51, 0.6)',
				cursor: 'pointer',
			});
		}else{
			elPin.text('').css({display: 'none'});
		}

		this.dispatchEvent({type: 'inspection', pick: pick});
	}

	onUpdate(){
		this.updateMarker();
	}

	hidePanel(){
		if(this.panel){
			this.panel.remove();
			this.panel = null;
		}
	}

	/**
	 * The rows of the readout: one per attribute of the picked point.
	 */
	createRows(pick){
		let {pointcloud, point, location, distance} = pick;
		let material = pointcloud.material;
		let decimals = this.decimalsFor(pointcloud);
		let rows = [];

		let addRow = (label, text, color) => {
			let el = $(`
				<div style="display: flex; align-items: center; gap: 6px; padding: 1.5px 0px; line-height: 1.4;">
					<span style="flex: 0 0 40%; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
					<span style="flex-grow: 1; text-align: right; word-break: break-word;"></span>
				</div>
			`);

			el.find('span').eq(0).text(label);
			el.find('span').eq(1).text(text);

			if(color){
				let swatch = $(`
					<span title="Color"
						style="flex: 0 0 auto; width: 12px; height: 12px; border-radius: 2px;
								border: 1px solid rgba(255, 255, 255, 0.5);"></span>
				`);

				swatch.css('background', color);
				el.find('span').eq(1).after(swatch);
			}

			rows.push({label: label, value: text, element: el});
		};

		// POSITION
		addRow('Position',
			`${location.x.toFixed(decimals)}, ${location.y.toFixed(decimals)}, ${location.z.toFixed(decimals)}`);

		// ATTRIBUTES
		for(let attributeName of Object.keys(point)){
			if(attributeName === 'position'){
				continue;
			}

			let values = Array.from(point[attributeName]);
			let label = InspectionTool.labelFor(attributeName);

			if(attributeName === 'rgba' || attributeName === 'color'){
				let [r, g, b] = values;
				addRow(label, `${r}, ${g}, ${b}`, `rgb(${r}, ${g}, ${b})`);

				continue;
			}

			if(attributeName === 'classification'){
				let value = values[0];
				let classification = this.viewer.classifications ? this.viewer.classifications[value] : undefined;
				let name = classification && classification.name ? classification.name : 'no name';
				let color = classification && classification.color
					? `rgb(${Math.round(255 * classification.color[0])}, ${Math.round(255 * classification.color[1])}, ${Math.round(255 * classification.color[2])})`
					: undefined;

				addRow(label, `${value} – ${name}`, color);

				continue;
			}

			// custom categorical fields: show the name and color of the class
			let scheme = material.getDiscreteScheme !== undefined
				? material.getDiscreteScheme(attributeName)
				: undefined;

			if(scheme && values.length === 1 && scheme.values[values[0]] !== undefined){
				let entry = scheme.values[values[0]];
				let color = `rgb(${Math.round(255 * entry.color[0])}, ${Math.round(255 * entry.color[1])}, ${Math.round(255 * entry.color[2])})`;

				addRow(label, `${values[0]} – ${entry.name}`, color);

				continue;
			}

			addRow(label, this.formatValues(values, decimals));
		}

		// DISTANCE
		if(distance !== undefined){
			addRow('Cam. distance', `${distance.toFixed(Math.max(decimals, 2))}`);
		}

		return rows;
	}

	createText(pick){
		let rows = this.createRows(pick);

		return rows.map(r => `${r.label}: ${r.value}`).join('\n');
	}

	formatValues(values, decimals){
		if(values.length === 0){
			return '-';
		}

		return values.map(v => {
			if(Number.isInteger(v)){
				return `${v}`;
			}

			return `${parseFloat(v.toFixed(Math.max(3, decimals)))}`;
		}).join(', ');
	}

	decimalsFor(pointcloud){
		let spacing = pointcloud.pcoGeometry.spacing;

		if(!spacing || !Number.isFinite(spacing) || spacing <= 0){
			return 3;
		}

		return Math.max(0, Math.min(6, Math.ceil(-Math.log10(spacing)) + 1));
	}

	static labelFor(attributeName){
		const LABELS = {
			'rgba': 'RGB',
			'color': 'RGB',
			'normal': 'Normal',
			'intensity': 'Intensity',
			'classification': 'Classification',
			'gps-time': 'GPS Time',
			'return number': 'Return Number',
			'number of returns': 'Number of Returns',
			'source id': 'Source ID',
			'point source id': 'Point Source ID',
			'spacing': 'Spacing',
			'indices': 'Indices',
		};

		if(LABELS[attributeName] !== undefined){
			return LABELS[attributeName];
		}

		return attributeName;
	}

	copyToClipboard(text){
		let done = () => {};

		if(navigator.clipboard && navigator.clipboard.writeText){
			navigator.clipboard.writeText(text).catch(() => this.copyFallback(text));

			return;
		}

		this.copyFallback(text);
	}

	copyFallback(text){
		let el = $(`<textarea style="position: fixed; top: -1000px; left: -1000px;"></textarea>`);
		el.val(text);
		$(document.body).append(el);
		el[0].select();

		try{
			document.execCommand('copy');
		}catch(e){
			// ignore, copying is a nicety
		}

		el.remove();
	}
};
