
module.exports = ECS
var DataStore = require('./dataStore')



/*!
 * ent-comp: a light, *fast* Entity Component System in JS
 * @url      github.com/fenomas/ent-comp
 * @author   Andy Hall <andy@fenomas.com>
 * @license  MIT
*/



/**
 * Constructor for a new entity-component-system manager.
 * 
 * ```js
 * var ECS = require('ent-comp')
 * var ecs = new ECS()
 * ```
 * @class
 * @constructor
 * @exports ECS
 * @typicalname ecs
*/

function ECS() {
	var self = this

	/** 
	 * Hash of component definitions. Also aliased to `comps`.
	 * 
	 * ```js
	 * var comp = { name: 'foo' }
	 * ecs.createComponent(comp)
	 * ecs.components['foo'] === comp  // true
	 * ecs.comps['foo']                // same
	 * ```
	*/
	this.components = {}
	this.comps = this.components



	/*
	 * 
	 * 		internal properties:
	 * 
	*/

	var components = this.components

	// counter for entity IDs
	var UID = 1

	// Storage for all component state data:
	// storage['component-name'] = DataStore instance
	var storage = {}

	// flat arrays of names of components with systems
	var systems = []
	var renderSystems = []

	// flags and arrays for deferred cleanup of removed stuff
	var deferrals = {
		timeout: false,
		removals: [],
		multiComps: [],
	}

	// expose references to internals for debugging or hacking
	this._storage = storage
	this._systems = systems
	this._renderSystems = renderSystems





	/*
	 * 
	 * 
	 * 				Public API
	 * 
	 * 
	*/




	/**
	 * Creates a new entity id (currently just an incrementing integer).
	 * 
	 * Optionally takes a list of component names to add to the entity (with default state data).
	 * 
	 * ```js
	 * var id1 = ecs.createEntity()
	 * var id2 = ecs.createEntity([ 'some-component', 'other-component' ])
	 * ```
	*/
	this.createEntity = function (compList) {
		var id = UID++
		if (Array.isArray(compList)) {
			compList.forEach(compName => self.addComponent(id, compName))
		}
		return id
	}



	/**
	 * Deletes an entity, which in practice means removing all its components.
	 * 
	 * ```js
	 * ecs.deleteEntity(id)
	 * ```
	*/
	this.deleteEntity = function (entID) {
		// loop over all components and maybe remove them
		// this avoids needing to keep a list of components-per-entity
		Object.keys(storage).forEach(compName => {
			var data = storage[compName]
			if (data.hash[entID]) {
				removeComponent(entID, compName)
			}
		})
		return self
	}







	/**
	 * Creates a new component from a definition object. 
	 * The definition must have a `name`; all other properties are optional.
	 * 
	 * Returns the component name, to make it easy to grab when the component
	 * is being `require`d from a module.
	 * 
	 * ```js
	 * var comp = {
	 * 	 name: 'some-unique-string',
	 * 	 state: {},
	 * 	 order: 99,
	 * 	 multi: false,
	 * 	 onAdd:        (id, state) => { },
	 * 	 onRemove:     (id, state) => { },
	 * 	 system:       (dt, states) => { },
	 * 	 renderSystem: (dt, states) => { },
	 * }
	 * 
	 * var name = ecs.createComponent( comp )
	 * // name == 'some-unique-string'
	 * ```
	 * 
	 * Note the `multi` flag - for components where this is true, a given 
	 * entity can have multiple state objects for that component.
	 * For multi-components, APIs that would normally return a state object 
	 * (like `getState`) will instead return an array of them.
	*/
	this.createComponent = function (compDefn) {
		if (!compDefn) throw new Error('Missing component definition')
		var name = compDefn.name
		if (!name) throw new Error('Component definition must have a name property.')
		if (typeof name !== 'string') throw new Error('Component name must be a string.')
		if (name === '') throw new Error('Component name must be a non-empty string.')
		if (storage[name]) throw new Error(`Component ${name} already exists.`)

		// rebuild definition object for monomorphism
		var internalDef = {}
		internalDef.name = name
		internalDef.multi = !!compDefn.multi
		internalDef.order = isNaN(compDefn.order) ? 99 : compDefn.order
		internalDef.stateConstructor = compDefn.stateConstructor || null
		internalDef.state = compDefn.state || {}
		internalDef.onAdd = compDefn.onAdd || null
		internalDef.onRemove = compDefn.onRemove || null
		internalDef.system = compDefn.system || null
		internalDef.renderSystem = compDefn.renderSystem || null

		components[name] = internalDef
		storage[name] = new DataStore()
		storage[name]._pendingMultiCleanup = false
		storage[name]._multiCleanupIDs = (internalDef.multi) ? [] : null

		if (internalDef.system) {
			systems.push(name)
			systems.sort((a, b) => components[a].order - components[b].order)
		}
		if (internalDef.renderSystem) {
			renderSystems.push(name)
			renderSystems.sort((a, b) => components[a].order - components[b].order)
		}

		return name
	}






	/**
	 * Overwrites an existing component with a new definition object, which
	 * must have the same `name` property as the component it overwrites.
	 * Otherwise identical to `createComponent`
	 * 
	 * ```js
	 *   ecs.createComponent({
	 *     name: 'foo',
	 *     state: { aaa: 0 },
	 *   })
	 *   ecs.addComponent(myEntity, 'foo')
	 *   ecs.getState(myEntity, 'foo').aaa = 123
	 *   
	 *   ecs.overwriteComponent('foo', {
	 *	   name: 'foo',
	 *	   state: { bbb: 456 },
	 *	 })
	 *   ecs.getState(myEntity, 'foo')  // { aaa:123, bbb:456 }
	 * ```
	 * 
	*/
	this.overwriteComponent = function (compName, compDefn) {
		var def = components[compName]
		if (!def) throw new Error(`Unknown component: ${compName}`)
		if (!compDefn) throw new Error('Missing component definition')
		if (def.name !== compDefn.name) throw new Error('Overwriting component must use the same name property.')

		// rebuild definition object for monomorphism
		var internalDef = {}
		internalDef.name = compName
		internalDef.multi = !!compDefn.multi
		internalDef.order = isNaN(compDefn.order) ? 99 : compDefn.order
		internalDef.state = compDefn.state || {}
		internalDef.onAdd = compDefn.onAdd || null
		internalDef.onRemove = compDefn.onRemove || null
		internalDef.system = compDefn.system || null
		internalDef.renderSystem = compDefn.renderSystem || null

		// overwrite internal references to old component def
		components[compName] = internalDef
		storage[compName]._pendingMultiCleanup = false
		storage[compName]._multiCleanupIDs = (internalDef.multi) ? [] : null

		var si = systems.indexOf(compName)
		if (internalDef.system && si < 0) systems.push(compName)
		if (!internalDef.system && si >= 0) systems.splice(si, 1)
		systems.sort((a, b) => components[a].order - components[b].order)

		var ri = renderSystems.indexOf(compName)
		if (internalDef.renderSystem && ri < 0) renderSystems.push(compName)
		if (!internalDef.renderSystem && ri >= 0) renderSystems.splice(ri, 1)
		renderSystems.sort((a, b) => components[a].order - components[b].order)

		// for any existing entities with the component,
		// add any default state properties they're missing
		var baseState = internalDef.state
		this.getStatesList(compName).forEach(state => {
			for (var key in baseState) {
				if (!(key in state)) state[key] = baseState[key]
			}
			// also call the new comp's add handler, if any
			if (internalDef.onAdd) internalDef.onAdd(state.__id, state)
		})


		return compName
	}







	/**
	 * Deletes the component definition with the given name. 
	 * First removes the component from all entities that have it.
	 * 
	 * **Note:** This API shouldn't be necessary in most real-world usage - 
	 * you should set up all your components during init and then leave them be.
	 * But it's useful if, say, you receive an ECS from another library and 
	 * you need to replace its components.
	 * 
	 * ```js
	 * ecs.deleteComponent( 'some-component' )
	 * ```
	*/
	this.deleteComponent = function (compName) {
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}`)

		data.flush()
		data.list.forEach(obj => {
			if (!obj) return
			var id = obj.__id || obj[0].__id
			removeComponent(id, compName)
		})

		var i = systems.indexOf(compName)
		var j = renderSystems.indexOf(compName)
		if (i > -1) systems.splice(i, 1)
		if (j > -1) renderSystems.splice(j, 1)

		storage[compName].dispose()
		delete storage[compName]
		delete components[compName]

		return self
	}




	/**
	 * Adds a component to an entity, optionally initializing the state object.
	 * 
	 * ```js
	 * ecs.createComponent({
	 * 	name: 'foo',
	 * 	state: { val: 1 }
	 * })
	 * ecs.addComponent(id1, 'foo')             // use default state
	 * ecs.addComponent(id2, 'foo', { val:2 })  // pass in state data
	 * ```
	*/
	this.addComponent = function (entID, compName, state) {
		var def = components[compName]
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}.`)

		// treat adding an existing (non-multi-) component as an error
		if (data.hash[entID] && !def.multi) {
			throw new Error(`Entity ${entID} already has component: ${compName}.`)
		}

		// create new component state object for this entity
		var newState
		console.log(def)
		if (def.stateConstructor) {
			console.log("stateConstructor route")
			newState = new def.stateConstructor()
			if (!newState.hasOwnProperty('__id')) {
				throw new Error(`Component ${def.name} stateConstructor type does not have property __id`)
			}
		}
		else {
			newState = Object.assign({}, { __id: entID }, def.state, state)
		}

		newState.__id = entID

		// add to data store - for multi components, may already be present
		if (def.multi) {
			var statesArr = data.hash[entID]
			if (!statesArr) {
				statesArr = []
				data.add(entID, statesArr)
			}
			statesArr.push(newState)
		} else {
			data.add(entID, newState)
		}

		// call handler and return
		if (def.onAdd) def.onAdd(entID, newState)

		return this
	}



	/**
	 * Checks if an entity has a component.
	 * 
	 * ```js
	 * ecs.addComponent(id, 'foo')
	 * ecs.hasComponent(id, 'foo')       // true
	 * ```
	*/

	this.hasComponent = function (entID, compName) {
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}.`)
		return !!data.hash[entID]
	}





	/**
	 * Removes a component from an entity, triggering the component's 
	 * `onRemove` handler, and then deleting any state data.
	 * 
	 * ```js
	 * ecs.removeComponent(id, 'foo')
	 * ecs.hasComponent(id, 'foo')     	 // false
	 * ```
	*/
	this.removeComponent = function (entID, compName) {
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}.`)

		// removal implementations at end
		removeComponent(entID, compName)

		return self
	}





	/**
	 * Get the component state for a given entity.
	 * It will automatically have an `__id` property for the entity id.
	 * 
	 * ```js
	 * ecs.createComponent({
	 * 	name: 'foo',
	 * 	state: { val: 0 }
	 * })
	 * ecs.addComponent(id, 'foo')
	 * ecs.getState(id, 'foo').val       // 0
	 * ecs.getState(id, 'foo').__id      // equals id
	 * ```
	*/

	this.getState = function (entID, compName) {
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}.`)
		return data.hash[entID]
	}




	/**
	 * Get an array of state objects for every entity with the given component. 
	 * Each one will have an `__id` property for the entity id it refers to.
	 * Don't add or remove elements from the returned list!
	 * 
	 * ```js
	 * var arr = ecs.getStatesList('foo')
	 * // returns something shaped like:
	 * //   [
	 * //     {__id:0, x:1},
	 * //     {__id:7, x:2},
	 * //   ]
	 * ```  
	*/

	this.getStatesList = function (compName) {
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}.`)
		doDeferredCleanup(data)
		return data.list
	}




	/**
	 * Makes a `getState`-like accessor bound to a given component. 
	 * The accessor is faster than `getState`, so you may want to create 
	 * an accessor for any component you'll be accessing a lot.
	 * 
	 * ```js
	 * ecs.createComponent({
	 * 	name: 'size',
	 * 	state: { val: 0 }
	 * })
	 * var getEntitySize = ecs.getStateAccessor('size')
	 * // ...
	 * ecs.addComponent(id, 'size', { val:123 })
	 * getEntitySize(id).val      // 123
	 * ```  
	*/

	this.getStateAccessor = function (compName) {
		if (!storage[compName]) throw new Error(`Unknown component: ${compName}.`)
		var hash = storage[compName].hash
		return (id) => hash[id]
	}




	/**
	 * Makes a `hasComponent`-like accessor function bound to a given component. 
	 * The accessor is much faster than `hasComponent`.
	 * 
	 * ```js
	 * ecs.createComponent({
	 * 	name: 'foo',
	 * })
	 * var hasFoo = ecs.getComponentAccessor('foo')
	 * // ...
	 * ecs.addComponent(id, 'foo')
	 * hasFoo(id) // true
	 * ```  
	*/

	this.getComponentAccessor = function (compName) {
		if (!storage[compName]) throw new Error(`Unknown component: ${compName}.`)
		var hash = storage[compName].hash
		return (id) => !!hash[id]
	}





	/**
	 * Tells the ECS that a game tick has occurred, causing component 
	 * `system` functions to get called.
	 * 
	 * The optional parameter simply gets passed to the system functions. 
	 * It's meant to be a timestep, but can be used (or not used) as you like.    
	 * 
	 * If components have an `order` property, they'll get called in that order
	 * (lowest to highest). Component order defaults to `99`.
	 * ```js
	 * ecs.createComponent({
	 * 	name: foo,
	 * 	order: 1,
	 * 	system: function(dt, states) {
	 * 		// states is the same array you'd get from #getStatesList()
	 * 		states.forEach(state => {
	 * 			console.log('Entity ID: ', state.__id)
	 * 		})
	 * 	}
	 * })
	 * ecs.tick(30) // triggers log statements
	 * ```
	*/

	this.tick = function (dt) {
		doDeferredCleanup()
		for (var i = 0; i < systems.length; i++) {
			var compName = systems[i]
			var comp = components[compName]
			var data = storage[compName]
			comp.system(dt, data.list)
			doDeferredCleanup()
		}
		return self
	}



	/**
	 * Functions exactly like `tick`, but calls `renderSystem` functions.
	 * this effectively gives you a second set of systems that are 
	 * called with separate timing, in case you want to 
	 * [tick and render in separate loops](http://gafferongames.com/game-physics/fix-your-timestep/)
	 * (which you should!).
	 * 
	 * ```js
	 * ecs.createComponent({
	 * 	name: foo,
	 * 	order: 5,
	 * 	renderSystem: function(dt, states) {
	 * 		// states is the same array you'd get from #getStatesList()
	 * 	}
	 * })
	 * ecs.render(1000/60)
	 * ```
	*/

	this.render = function (dt) {
		doDeferredCleanup()
		for (var i = 0; i < renderSystems.length; i++) {
			var compName = renderSystems[i]
			var comp = components[compName]
			var data = storage[compName]
			comp.renderSystem(dt, data.list)
			doDeferredCleanup()
		}
		return self
	}




	/**
	 * Removes one particular instance of a multi-component.
	 * To avoid breaking loops, the relevant state object will get nulled
	 * immediately, and spliced from the states array later when safe 
	 * (after the current tick/render/animationFrame).
	 * 
	 * ```js
	 * // where component 'foo' is a multi-component
	 * ecs.getState(id, 'foo')   // [ state1, state2, state3 ]
	 * ecs.removeMultiComponent(id, 'foo', 1)
	 * ecs.getState(id, 'foo')   // [ state1, null, state3 ]
	 * // one JS event loop later...
	 * ecs.getState(id, 'foo')   // [ state1, state3 ]
	 * ```
	 */
	this.removeMultiComponent = function (entID, compName, index) {
		var def = components[compName]
		var data = storage[compName]
		if (!data) throw new Error(`Unknown component: ${compName}.`)
		if (!def.multi) throw new Error('removeMultiComponent called on non-multi component')

		// removal implementations at end
		removeMultiCompElement(entID, def, data, index)

		return self
	}













	/*
	 * 
	 * 
	 *		internal implementations of remove/delete operations
	 * 		a bit hairy due to deferred cleanup, etc.
	 * 
	 * 
	*/


	// remove given component from an entity
	function removeComponent(entID, compName) {
		var def = components[compName]
		var data = storage[compName]

		// fail silently on all cases where removal target isn't present,
		// since multiple pieces of logic often remove/delete simultaneously
		var state = data.hash[entID]
		if (!state) return

		// null out data now, so overlapped remove events won't fire
		data.remove(entID)

		// call onRemove handler - on each instance for multi components
		if (def.onRemove) {
			if (def.multi) {
				state.forEach(state => {
					if (state) def.onRemove(entID, state)
				})
				state.length = 0
			} else {
				def.onRemove(entID, state)
			}
		}

		deferrals.removals.push(data)
		pingDeferrals()
	}


	// remove one state from a multi component
	function removeMultiCompElement(entID, def, data, index) {
		// if statesArr isn't present there's no work or cleanup to do
		var statesArr = data.hash[entID]
		if (!statesArr) return

		// as above, ignore cases where removal target doesn't exist
		var state = statesArr[index]
		if (!state) return

		// null out element and fire event
		statesArr[index] = null
		if (def.onRemove) def.onRemove(entID, state)

		deferrals.multiComps.push({ entID, data })
		pingDeferrals()
	}







	// rigging
	function pingDeferrals() {
		if (deferrals.timeout) return
		deferrals.timeout = true
		setTimeout(deferralHandler, 1)
	}

	function deferralHandler() {
		deferrals.timeout = false
		doDeferredCleanup()
	}


	/*
	 * 
	 *		general handling for deferred data cleanup
	 * 			- removes null states if component is multi
	 * 			- removes null entries from component dataStore
	 * 		should be called at safe times - not during state loops
	 * 
	*/

	function doDeferredCleanup() {
		if (deferrals.multiComps.length) {
			deferredMultiCompCleanup(deferrals.multiComps)
		}
		if (deferrals.removals.length) {
			deferredComponentCleanup(deferrals.removals)
		}
	}

	// removes null elements from multi-comp state arrays
	function deferredMultiCompCleanup(list) {
		for (var i = 0; i < list.length; i++) {
			var { entID, data } = list[i]
			var statesArr = data.hash[entID]
			if (!statesArr) continue
			for (var j = 0; j < statesArr.length; j++) {
				if (statesArr[j]) continue
				statesArr.splice(j, 1)
				j--
			}
			// if this leaves the states list empty, remove the whole component
			if (statesArr.length === 0) {
				data.remove(entID)
				deferrals.removals.push(data)
			}
		}
		list.length = 0
	}

	// flushes dataStore after components have been removed
	function deferredComponentCleanup(list) {
		for (var i = 0; i < list.length; i++) {
			var data = list[i]
			data.flush()
		}
		list.length = 0
	}



}

