

/*
 * 
 *      Encapsulates (mostly) a collection of objects, 
 *      exposed both as a hash and as an array
 *      _map maps hash id to list index
 * 
 *      Note this is a dumb store, it doesn't check any inputs at all.
 *      It also assumes every stored data object is stored like:
 *          dataStore.add(37, {__id:37} )
 * 
*/


module.exports = class DataStore {

    constructor() {
        this.list = []
        this.hash = {}
        this._map = {}
        // Parallel array to `list`: _idList[i] is the id of list[i], enabling O(1) id lookup during removal
        this._idList = []
        this._pendingRemovals = []
    }


    // add a new state object
    add(id, stateObject) {
        if (typeof this._map[id] === 'number') {
            // this happens if id is removed/readded without flushing
            var index = this._map[id]
            this.hash[id] = stateObject
            this.list[index] = stateObject
            this._idList[index] = id
        } else {
            this._map[id] = this.list.length
            this.hash[id] = stateObject
            this.list.push(stateObject)
            this._idList.push(id)
        }
    }


    // remove - nulls the state object, actual removal comes later
    remove(id) {
        var index = this._map[id]
        this.hash[id] = null
        this.list[index] = null
        this._pendingRemovals.push(id)
    }


    // just sever references
    dispose() {
        this.list = null
        this.hash = null
        this._map = null
        this._idList = null
        this._pendingRemovals.length = 0
    }


    // deletes removed objects from data structures
    flush() {
        for (var i = 0; i < this._pendingRemovals.length; i++) {
            var id = this._pendingRemovals[i]
            // removal might have been reversed, or already handled
            if (this.hash[id] !== null) continue
            removeElement(this, id)
        }
        this._pendingRemovals.length = 0
    }

}


/*
 * 
 *      actual remove / cleanup logic, fixes up data structures after removal
 * 
 * 
*/


function removeElement(data, id) {
    // current location of this element in the list
    var index = data._map[id]
    // for hash and map, just delete by id
    delete data.hash[id]
    delete data._map[id]
    // now splice - either by popping or by swapping with final element
    if (index === data.list.length - 1) {
        data.list.pop()
        data._idList.pop()
    } else {
        // swap last item with the one we're removing
        var swapped = data.list.pop()
        data.list[index] = swapped
        // fix up _map for the swapped item, reading its id from _idList in O(1)
        // rather than scanning _map in O(n)
        var swappedID = data._idList.pop()
        data._idList[index] = swappedID
        data._map[swappedID] = index
    }
}


