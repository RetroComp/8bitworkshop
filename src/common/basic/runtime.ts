
import * as basic from "./compiler";
import { EmuHalt } from "../emu";
import { SourceLocation } from "../workertypes";

function isLiteral(arg: basic.Expr): arg is basic.Literal {
    return (arg as any).value != null;
}
function isLookup(arg: basic.Expr): arg is basic.IndOp {
    return (arg as any).name != null;
}
function isBinOp(arg: basic.Expr): arg is basic.BinOp {
    return (arg as any).op != null && (arg as any).left != null && (arg as any).right != null;
}
function isUnOp(arg: basic.Expr): arg is basic.UnOp {
    return (arg as any).op != null && (arg as any).expr != null;
}

// expr2js() options
class ExprOptions {
    isconst?: boolean;      // only allow constant operations
    novalid?: boolean;      // check for valid values when fetching
    locals?: string[];      // pass local variable names when defining functions
}

interface CompiledStatement {
    $run?: () => void;
}

function isArray(obj) {
    return obj != null && (Array.isArray(obj) || obj.BYTES_PER_ELEMENT);
}

class RNG {
    next : () => number;
    seed : (aa,bb,cc,dd) => void;
    randomize() {
        this.seed(Math.random()*0x7fffffff, Math.random()*0x7fffffff, Math.random()*0x7fffffff, Math.random()*0x7fffffff);
    }
    constructor() {
        let f = () => {
            var a, b, c, d : number;
            this.seed = function(aa,bb,cc,dd) {
                a = aa; b = bb; c = cc; d = dd;
            }
            this.next = function() {
                // sfc32
                a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; 
                var t = (a + b) | 0;
                a = b ^ b >>> 9;
                b = c + (c << 3) | 0;
                c = (c << 21 | c >>> 11);
                d = d + 1 | 0;
                t = t + d | 0;
                c = c + t | 0;
                return (t >>> 0) / 4294967296;
            }
        };
        f();
        this.seed(0x12345678, 0xdeadbeef, 0xf0d3984e, 0xfeed3660); //default seed
        this.next();
        this.next();
    }
};

export class BASICRuntime {

    program : basic.BASICProgram;
    allstmts : basic.Statement[];
    line2pc : number[];
    pc2line : Map<number,number>;
    label2lineidx : {[label : string] : number};
    label2pc : {[label : string] : number};
    label2dataptr : {[label : string] : number};
    datums : basic.Literal[];
    builtins : {};
    opts : basic.BASICOptions;

    curpc : number;
    dataptr : number;
    vars : {};
    arrays : {};
    defs : {};
    forLoops : { [varname:string] : { $next:(name:string) => void } };
    forLoopStack: string[];
    whileLoops : number[];
    returnStack : number[];
    column : number;
    rng : RNG;

    running : boolean = false;
    exited : boolean = true;
    trace : boolean = false;

    load(program: basic.BASICProgram) {
        let prevlabel = this.label2pc && this.getLabelForPC(this.curpc);
        this.program = program;
        this.opts = program.opts;
        this.label2lineidx = {};
        this.label2pc = {};
        this.label2dataptr = {};
        this.allstmts = [];
        this.line2pc = [];
        this.pc2line = new Map();
        this.datums = [];
        this.builtins = this.getBuiltinFunctions();
        // TODO: detect undeclared vars
        program.lines.forEach((line, idx) => {
            // make lookup tables
            if (line.label != null) this.label2lineidx[line.label] = idx;
            if (line.label != null) this.label2pc[line.label] = this.allstmts.length;
            this.line2pc.push(this.allstmts.length);
            this.pc2line.set(this.allstmts.length, idx);
            // combine all statements into single list
            line.stmts.forEach((stmt) => this.allstmts.push(stmt));
        });
        // compile statements ahead of time
        this.allstmts.forEach((stmt, pc) => {
            this.curpc = pc + 1; // for error reporting
            this.compileStatement(stmt);
        });
        // parse DATA literals
        this.allstmts.filter((stmt) => stmt.command == 'DATA').forEach((datastmt) => {
            (datastmt as basic.DATA_Statement).datums.forEach(datum => {
                this.curpc = datastmt.$loc.offset; // for error reporting
                this.label2dataptr[datastmt.$loc.label] = this.datums.length;
                this.datums.push(datum);
            });
        });
        // try to resume where we left off after loading
        this.curpc = this.label2pc[prevlabel] || 0;
        this.dataptr = Math.min(this.dataptr, this.datums.length);
    }

    reset() {
        this.curpc = 0;
        this.dataptr = 0;
        this.clearVars();
        this.returnStack = [];
        this.column = 0;
        this.running = true;
        this.exited = false;
    }
    clearVars() {
        this.vars = {};
        this.arrays = {};
        this.defs = {}; // TODO? only in interpreters
        this.forLoops = {};
        this.forLoopStack = [];
        this.whileLoops = [];
        this.rng = new RNG();
        // initialize arrays?
        if (this.opts && this.opts.staticArrays) {
            this.allstmts.filter((stmt) => stmt.command == 'DIM').forEach((dimstmt: basic.DIM_Statement) => {
                dimstmt.args.forEach( (arg) => this.compileJS(this._DIM(arg))() );
            });
        }
    }
    
    // TODO: saveState(), loadState()
    saveState() {
        // TODO: linked list loop?
        return $.extend(true, {}, this);
    }
    loadState(state) {
        $.extend(true, this, state);
    }
    
    getBuiltinFunctions() {
        var fnames = this.program && this.opts.validFunctions;
        // if no valid function list, look for ABC...() functions in prototype
        if (!fnames) fnames = Object.keys(BASICRuntime.prototype).filter((name) => /^[A-Z]{3,}[$]?$/.test(name));
        var dict = {};
        for (var fn of fnames) if (this[fn]) dict[fn] = this[fn].bind(this);
        return dict;
    }

    runtimeError(msg : string) {
        this.curpc--; // we did curpc++ before executing statement
        throw new EmuHalt(msg, this.getCurrentSourceLocation());
    }
    
    dialectError(what : string) {
        this.runtimeError(`I can't ${what} in this dialect of BASIC.`);
    }

    getLineForPC(pc:number) {
        var stmt = this.allstmts[pc];
        return stmt && stmt.$loc && stmt.$loc.line;
    }

    getLabelForPC(pc:number) {
        var stmt = this.allstmts[pc];
        return stmt && stmt.$loc && stmt.$loc.label;
    }

    getCurrentSourceLocation() : SourceLocation {
        var stmt = this.getStatement();
        return stmt && stmt.$loc;
    }

    getCurrentLabel() : string {
        var loc = this.getCurrentSourceLocation();
        return loc && loc.label;
    }

    getStatement() {
        return this.allstmts[this.curpc];
    }

    step() : boolean {
        if (!this.running) return false;
        var stmt = this.getStatement();
        // end of program?
        if (!stmt) {
            this.running = false;
            this.exited = true;
            return false;
        }
        if (this.trace) console.log(this.curpc, stmt, this.vars, Object.keys(this.arrays));
        // skip to next statment
        this.curpc++;
        // compile (unless cached) and execute statement
        this.executeStatement(stmt);
        return this.running;
    }

    compileStatement(stmt: basic.Statement & CompiledStatement) {
        if (stmt.$run == null) {
            try {
                var stmtfn = this['do__' + stmt.command];
                if (stmtfn == null) this.runtimeError(`I don't know how to "${stmt.command}".`);
                var functext = stmtfn.bind(this)(stmt);
                if (this.trace) console.log(functext);
                stmt.$run = this.compileJS(functext);
            } catch (e) {
                console.log(functext);
                throw e;
            }
        }
    }
    compileJS(functext: string) : () => void {
        return new Function(functext).bind(this);
    }
    executeStatement(stmt: basic.Statement & CompiledStatement) {
        // compile (unless cached)
        this.compileStatement(stmt);
        // run compiled statement
        stmt.$run();
    }

    skipToEOL() {
        do {
            this.curpc++;
        } while (this.curpc < this.allstmts.length && !this.pc2line.get(this.curpc));
    }

    skipToElse() {
        do {
            // in Altair BASIC, ELSE is bound to the right-most IF
            // TODO: this is complicated, we should just have nested expressions
            var cmd = this.allstmts[this.curpc].command;
            if (cmd == 'ELSE') { this.curpc++; break; }
            else if (cmd == 'IF') return this.skipToEOL();
            this.curpc++;
        } while (this.curpc < this.allstmts.length && !this.pc2line.get(this.curpc));
    }

    skipToEOF() {
        this.curpc = this.allstmts.length;
    }

    skipToAfterNext(forname: string) : void {
        var pc = this.curpc;
        while (pc < this.allstmts.length) {
            var stmt = this.allstmts[pc];
            if (stmt.command == 'NEXT') {
                var nextlexpr = (stmt as basic.NEXT_Statement).lexpr;
                if (nextlexpr && nextlexpr.name == forname) {
                    this.curpc = pc + 1;
                    return;
                }
            }
            pc++;
        }
        this.runtimeError(`I couldn't find a matching NEXT ${forname} to skip this for loop.`);
    }

    skipToAfterWend() {
        var pc = this.curpc - 1;
        var nesting = 0;
        while (pc < this.allstmts.length) {
            var stmt = this.allstmts[pc];
            console.log(nesting, pc, stmt);
            if (stmt.command == 'WHILE') {
                nesting++;
            } else if (stmt.command == 'WEND') {
                nesting--;
                if (nesting == 0) {
                    this.curpc = pc + 1;
                    return;
                }
            }
            pc++;
        }
        this.runtimeError(`I couldn't find a matching WEND for this WHILE.`);
    }

    gotoLabel(label) {
        var pc = this.label2pc[label];
        if (pc >= 0) {
            this.curpc = pc;
        } else {
            this.runtimeError(`I tried to go to the label "${label}" but couldn't find it.`);
        }
    }

    gosubLabel(label) {
        if (this.returnStack.length > 32767) // TODO: const?
            this.runtimeError(`I did too many GOSUBs without a RETURN.`)
        this.returnStack.push(this.curpc);
        this.gotoLabel(label);
    }

    returnFromGosub() {
        if (this.returnStack.length == 0)
            this.runtimeError("I tried to RETURN, but there wasn't a corresponding GOSUB."); // RETURN BEFORE GOSUB
        var pc = this.returnStack.pop();
        this.curpc = pc;
    }

    popReturnStack() {
        if (this.returnStack.length == 0)
            this.runtimeError("I tried to POP, but there wasn't a corresponding GOSUB.");
        this.returnStack.pop();
    }

    valueToString(obj) : string {
        var str;
        if (typeof obj === 'number') {
            var numstr = obj.toString().toUpperCase();
            if (this.opts.printZoneLength > 4) {
                var numlen = this.opts.printZoneLength - 4;
                var prec = numlen;
                while (numstr.length > numlen) {
                    numstr = obj.toPrecision(prec--);
                }
                if (numstr.startsWith('0.'))
                    numstr = numstr.substr(1);
                else if (numstr.startsWith('-0.'))
                    numstr = '-'+numstr.substr(2);
            }
            if (!this.opts.numericPadding)
                str = numstr;
            else if (numstr.startsWith('-'))
                str = `${numstr} `;
            else
                str = ` ${numstr} `;
        } else if (obj == '\n') {
            this.column = 0;
            str = obj;
        } else if (obj == '\t') {
            var curgroup = Math.floor(this.column / this.opts.printZoneLength);
            var nextcol = (curgroup + 1) * this.opts.printZoneLength;
            str = this.TAB(nextcol);
        } else {
            str = `${obj}`;
        }
        return str;
    }

    printExpr(obj) {
        var str = this.valueToString(obj);
        this.column += str.length;
        this.print(str);
    }

    // override this
    print(str: string) {
        console.log(str);
    }

    // override this
    async input(prompt: string, nargs: number) : Promise<string[]> {
        return [];
    }

    // override this
    resume() { }

    expr2js(expr: basic.Expr, opts?: ExprOptions) : string {
        if (!opts) opts = {};
        if (isLiteral(expr)) {
            return JSON.stringify(expr.value);
        } else if (isLookup(expr)) {
            if (!expr.args && opts.locals && opts.locals.indexOf(expr.name) >= 0) {
                return expr.name; // local arg in DEF
            } else {
                if (opts.isconst)
                    this.runtimeError(`I expected a constant value here.`); // TODO: check at compile-time?
                var s = '';
                var qname = JSON.stringify(expr.name);
                let jsargs = expr.args ? expr.args.map((arg) => this.expr2js(arg, opts)).join(', ') : [];
                if (expr.name.startsWith("FN")) { // is it a user-defined function?
                    // TODO: check argument count?
                    s += `this.getDef(${qname})(${jsargs})`;
                    // TODO: detect recursion?
                } else if (this.builtins[expr.name]) { // is it a built-in function?
                    this.checkFuncArgs(expr, this.builtins[expr.name]);
                    s += `this.builtins.${expr.name}(${jsargs})`;
                } else if (expr.args) {
                    if (this.opts.arraysContainChars && expr.name.endsWith('$'))
                        s += `this.MID$(this.vars.${expr.name}, ${jsargs})`;
                    else
                        s += `this.arrayGet(${qname}, ${jsargs})`;
                } else { // just a variable
                    s += `this.vars.${expr.name}`;
                }
                return opts.novalid ? s : `this.checkValue(${s}, ${qname})`;
            }
        } else if (isBinOp(expr)) {
            var left = this.expr2js(expr.left, opts);
            var right = this.expr2js(expr.right, opts);
            return `this.${expr.op}(${left}, ${right})`;
        } else if (isUnOp(expr)) {
            var e = this.expr2js(expr.expr, opts);
            return `this.${expr.op}(${e})`;
        }
    }

    assign2js(expr: basic.IndOp, opts?: ExprOptions) {
        if (!opts) opts = {};
        var s = '';
        var qname = JSON.stringify(expr.name);
         // is it a function? not allowed
        if (expr.name.startsWith("FN") || this.builtins[expr.name]) this.runtimeError(`I can't call a function here.`);
        // is it a subscript?
        if (expr.args) {
            s += this.expr2js(expr, {novalid:true}); // check array bounds
            s += `;this.getArray(${qname}, ${expr.args.length})`;
            s += expr.args.map((arg) => '[this.ROUND('+this.expr2js(arg, opts)+')]').join('');
        } else { // just a variable
            s = `this.vars.${expr.name}`;
        }
        return s;
    }

    checkFuncArgs(expr: basic.IndOp, fn: Function) {
        // TODO: check types?
        var nargs = expr.args ? expr.args.length : 0;
        // exceptions
        if (expr.name == 'RND' && nargs == 0) return;
        if (expr.name == 'MID$' && nargs == 2) return;
        if (expr.name == 'INSTR' && nargs == 2) return;
        if (fn.length != nargs)
            this.runtimeError(`I expected ${fn.length} arguments for the ${expr.name} function, but I got ${nargs}.`);
    }

    startForLoop(forname, init, targ, step) {
        var pc = this.curpc;
        if (!step) step = 1;
        this.vars[forname] = init;
        if (this.trace) console.log(`FOR ${forname} = ${init} TO ${targ} STEP ${step}`);
        // create done function
        var loopdone = () => {
            return step >= 0 ? this.vars[forname] > targ : this.vars[forname] < targ;
        }
        // skip entire for loop before first iteration? (Minimal BASIC)
        if (this.opts.testInitialFor && loopdone())
            return this.skipToAfterNext(forname);
        // save for var name on stack, remove existing entry
        if (this.forLoopStack[forname] != null)
            this.forLoopStack = this.forLoopStack.filter((n) => n == forname);
        this.forLoopStack.push(forname);
        // create for loop record
        this.forLoops[forname] = {
            $next: (nextname:string) => {
                if (nextname && forname != nextname)
                    this.runtimeError(`I executed NEXT "${nextname}", but the last FOR was for "${forname}".`)
                this.vars[forname] += step;
                var done = loopdone();
                if (done) {
                    // delete entry, pop FOR off the stack and continue
                    this.forLoopStack.pop();
                    delete this.forLoops[forname];
                } else {
                    this.curpc = pc; // go back to FOR location
                }
                if (this.trace) console.log(`NEXT ${forname}: ${this.vars[forname]} TO ${targ} STEP ${step} DONE=${done}`);
            }
        };
    }

    nextForLoop(name) {
        // get FOR loop entry, or get top of stack if NEXT var is optional 
        var fl = this.forLoops[name || (this.opts.optionalNextVar && this.forLoopStack[this.forLoopStack.length-1])];
        if (!fl) this.runtimeError(`I couldn't find a matching FOR for this NEXT.`)
        fl.$next(name);
    }

    whileLoop(cond) {
        if (cond) {
            this.whileLoops.push(this.curpc-1);
        } else {
            this.skipToAfterWend();
        }
    }

    nextWhileLoop() {
        var pc = this.whileLoops.pop();
        if (pc == null) this.runtimeError(`I couldn't find a matching WHILE for this WEND.`);
        else this.curpc = pc;
    }

    // converts a variable to string/number based on var name
    assign(name: string, right: number|string, isRead?:boolean) : number|string {
        // convert data? READ always converts if read into string
        if (this.opts.typeConvert || (isRead && name.endsWith("$")))
            return this.convert(name, right);
        // TODO: use options
        if (name.endsWith("$")) {
            return this.convertToString(right, name);
        } else {
            return this.convertToNumber(right, name);
        }
    }

    convert(name: string, right: number|string) : number|string {
        if (name.endsWith("$")) {
            return right == null ? "" : right.toString();
        } else if (typeof right === 'number') {
            return right;
        } else {
            return parseFloat(right+"");
        }
    }

    convertToString(right: number|string, name?: string) {
        if (typeof right !== 'string') this.runtimeError(`I can't convert ${right} to a string.`);
        else return right;
    }

    convertToNumber(right: number|string, name?: string) {
        if (typeof right !== 'number') this.runtimeError(`I can't convert ${right} to a number.`);
        else return this.checkNum(right);
    }

    // dimension array
    dimArray(name: string, ...dims:number[]) {
        // TODO: maybe do this check at compile-time?
        if (this.arrays[name] != null) {
            if (this.opts.staticArrays) return;
            else this.runtimeError(`I already dimensioned this array (${name}) earlier.`)
        }
        var isstring = name.endsWith('$');
        // if numeric value, we use Float64Array which inits to 0
        var arrcons = isstring ? Array : Float64Array;
        if (dims.length == 1) {
            this.arrays[name] = new arrcons(dims[0]+1);
        } else if (dims.length == 2) {
            this.arrays[name] = new Array(dims[0]+1);
            for (var i=0; i<dims[0]+1; i++) {
                this.arrays[name][i] = new arrcons(dims[1]+1);
            }
        } else {
            this.runtimeError(`I only support arrays of one or two dimensions.`)
        }
    }

    getArray(name: string, order: number) : [] {
        if (!this.arrays[name]) {
            if (this.opts.defaultArraySize == 0)
                this.dialectError(`automatically declare arrays without a DIM statement`);
            if (order == 1)
                this.dimArray(name, this.opts.defaultArraySize-1);
            else if (order == 2)
                this.dimArray(name, this.opts.defaultArraySize-1, this.opts.defaultArraySize-1);
            else
                this.runtimeError(`I only support arrays of one or two dimensions.`); // TODO
        }
        return this.arrays[name];
    }

    arrayGet(name: string, ...indices: number[]) : basic.Value {
        var arr = this.getArray(name, indices.length);
        indices = indices.map(Math.round);
        var v = arr;
        for (var i=0; i<indices.length; i++) {
            var idx = indices[i];
            if (!isArray(v))
                this.runtimeError(`I tried to lookup ${name}(${indices}) but used too many dimensions.`);
            if (idx < this.opts.defaultArrayBase)
                this.runtimeError(`I tried to lookup ${name}(${indices}) but an index was less than ${this.opts.defaultArrayBase}.`);
            if (idx >= v.length) // TODO: also can happen when mispelling function name
                this.runtimeError(`I tried to lookup ${name}(${indices}) but it exceeded the dimensions of the array.`);
            v = v[indices[i]];
        }
        if (isArray(v)) // i.e. is an array?
            this.runtimeError(`I tried to lookup ${name}(${indices}) but used too few dimensions.`);
        return (v as any) as basic.Value;
    }

    // for HP BASIC string slicing
    modifyStringSlice(orig: string, add: string, start: number, end: number) : string {
        return orig.substr(0, start-1) + add + orig.substr(end);
    }

    checkOnGoto(value: number, labels: string[]) {
        value = this.ROUND(value);
        if (value < 0) // > 255 ?
            this.runtimeError(`I needed a number between 1 and ${labels.length}, but I got ${value}.`);
        if (this.opts.checkOnGotoIndex && (value < 1 || value > labels.length))
            this.runtimeError(`I needed a number between 1 and ${labels.length}, but I got ${value}.`);
        if (value < 1 || value > labels.length)
            return 0;
        return value;
    }
    
    onGotoLabel(value: number, ...labels: string[]) {
        value = this.checkOnGoto(value, labels);
        if (value) this.gotoLabel(labels[value-1]);
    }
    onGosubLabel(value: number, ...labels: string[]) {
        value = this.checkOnGoto(value, labels);
        if (value) this.gosubLabel(labels[value-1]);
    }

    nextDatum() : basic.Value {
        if (this.dataptr >= this.datums.length)
            this.runtimeError("I tried to READ, but ran out of data.");
        return this.datums[this.dataptr++].value;
    }

    //// STATEMENTS

    do__PRINT(stmt : basic.PRINT_Statement) {
        var s = '';
        for (var arg of stmt.args) {
            var expr = this.expr2js(arg);
            s += `this.printExpr(${expr});`;
        }
        return s;
    }

    do__INPUT(stmt : basic.INPUT_Statement) {
        var prompt = this.expr2js(stmt.prompt);
        var setvals = '';
        stmt.args.forEach((arg, index) => {
            var lexpr = this.assign2js(arg);
            setvals += `
            var value = this.convert(${JSON.stringify(arg.name)}, vals[${index}]);
            valid &= this.isValid(value);
            ${lexpr} = value;
            `
        });
        return `this.running=false; this.curpc--;
                this.input(${prompt}, ${stmt.args.length}).then((vals) => {
                    let valid = 1;
                    ${setvals}
                    if (valid) this.curpc++;
                    this.running=true;
                    this.resume();
                })`;
    }

    do__LET(stmt : basic.LET_Statement) {
        var lexpr = this.assign2js(stmt.lexpr);
        var right = this.expr2js(stmt.right);
        // HP BASIC string-slice syntax?
        if (this.opts.arraysContainChars && stmt.lexpr.args && stmt.lexpr.name.endsWith('$')) {
            var s = `this.vars.${stmt.lexpr.name} = this.modifyStringSlice(this.vars.${stmt.lexpr.name}, ${right}, `
            s += stmt.lexpr.args.map((arg) => this.expr2js(arg)).join(', ');
            s += ')';
            console.log(s);
            return s;
        } else {
            return `${lexpr} = this.assign(${JSON.stringify(stmt.lexpr.name)}, ${right});`;
        }
    }

    do__FOR(stmt : basic.FOR_Statement) {
        var name = JSON.stringify(stmt.lexpr.name);
        var init = this.expr2js(stmt.initial);
        var targ = this.expr2js(stmt.target);
        var step = stmt.step ? this.expr2js(stmt.step) : 'null';
        return `this.startForLoop(${name}, ${init}, ${targ}, ${step})`;
    }

    do__NEXT(stmt : basic.NEXT_Statement) {
        var name = stmt.lexpr && JSON.stringify(stmt.lexpr.name);
        return `this.nextForLoop(${name})`;
    }

    do__IF(stmt : basic.IF_Statement) {
        var cond = this.expr2js(stmt.cond);
        return `if (!(${cond})) { this.skipToElse(); }`
    }

    do__ELSE() {
        return `this.skipToEOL()`
    }

    do__WHILE(stmt : basic.WHILE_Statement) {
        var cond = this.expr2js(stmt.cond);
        return `this.whileLoop(${cond})`;
    }

    do__WEND() {
        return `this.nextWhileLoop()`
    }

    do__DEF(stmt : basic.DEF_Statement) {
        var args = [];
        for (var arg of stmt.lexpr.args || []) {
            if (isLookup(arg)) {
                args.push(arg.name);
            } else {
                this.runtimeError("I found a DEF statement with arguments other than variable names.");
            }
        }
        var functext = this.expr2js(stmt.def, {locals:args});
        //this.defs[stmt.lexpr.name] = new Function(args.join(','), functext).bind(this);
        return `this.defs.${stmt.lexpr.name} = function(${args.join(',')}) { return ${functext}; }.bind(this)`;
    }

    _DIM(dim : basic.IndOp) {
        // HP BASIC doesn't really have string arrays
        if (this.opts.arraysContainChars && dim.name.endsWith('$'))
            return;
        var argsstr = '';
        for (var arg of dim.args) {
            // TODO: check for float (or at compile time)
            argsstr += ', ' + this.expr2js(arg, {isconst: this.opts.staticArrays});
        }
        return `this.dimArray(${JSON.stringify(dim.name)}${argsstr});`;
    }

    do__DIM(stmt : basic.DIM_Statement) {
        if (this.opts.staticArrays) return; // DIM at reset()
        var s = '';
        stmt.args.forEach((dim) => s += this._DIM(dim));
        return s;
    }

    do__GOTO(stmt : basic.GOTO_Statement) {
        var label = this.expr2js(stmt.label);
        return `this.gotoLabel(${label})`;
    }

    do__GOSUB(stmt : basic.GOSUB_Statement) {
        var label = this.expr2js(stmt.label);
        return `this.gosubLabel(${label})`;
    }

    do__RETURN(stmt : basic.RETURN_Statement) {
        return `this.returnFromGosub()`;
    }

    do__ONGOTO(stmt : basic.ONGO_Statement) {
        var expr = this.expr2js(stmt.expr);
        var labels = stmt.labels.map((arg) => this.expr2js(arg, {isconst:true})).join(', ');
        if (stmt.command == 'ONGOTO')
            return `this.onGotoLabel(${expr}, ${labels})`;
        else
            return `this.onGosubLabel(${expr}, ${labels})`;
    }

    do__ONGOSUB(stmt : basic.ONGO_Statement) {
        return this.do__ONGOTO(stmt);
    }

    do__DATA() {
        // data is preprocessed
    }

    do__READ(stmt : basic.READ_Statement) {
        var s = '';
        stmt.args.forEach((arg) => {
            s += `${this.assign2js(arg)} = this.assign(${JSON.stringify(arg.name)}, this.nextDatum(), true);`;
        });
        return s;
    }

    do__RESTORE(stmt : basic.RESTORE_Statement) {
        if (stmt.label != null)
            return `this.dataptr = this.label2dataptr[${this.expr2js(stmt.label, {isconst:true})}] || 0`;
        else
            return `this.dataptr = 0`;
    }

    do__END() {
        return `this.skipToEOF()`;
    }

    do__STOP() {
        return `this.skipToEOF()`;
    }

    do__OPTION(stmt: basic.OPTION_Statement) {
        // already parsed in compiler
    }

    do__POP() {
        return `this.popReturnStack()`;
    }

    do__GET(stmt : basic.GET_Statement) {
        var lexpr = this.assign2js(stmt.lexpr);
        // TODO: single key input
        return `this.running=false; this.curpc--;
                this.input().then((vals) => {
                    ${lexpr} = this.convert(${JSON.stringify(stmt.lexpr.name)}, vals[0]);
                    this.running=true;  this.curpc++;
                    this.resume();
                })`;
    }

    do__CLEAR() {
        return 'this.clearVars()';
    }

    do__RANDOMIZE() {
        return `this.rng.randomize()`;
    }

    // TODO: ONERR, ON ERROR GOTO
    // TODO: gosubs nested too deeply
    // TODO: memory quota
    // TODO: useless loop (! 4th edition)
    // TODO: other 4th edition errors
    // TODO: ecma55 all-or-none input checking?

    // FUNCTIONS

    isValid(obj:number|string) : boolean {
        if (typeof obj === 'number' && !isNaN(obj) && (!this.opts.checkOverflow || isFinite(obj)))
            return true;
        else if (typeof obj === 'string')
            return true;
        else
            return false;
    }
    checkValue(obj:number|string, exprname:string) : number|string {
        // check for unreferenced value
        if (typeof obj !== 'number' && typeof obj !== 'string') {
            // assign default value?
            if (obj == null && this.opts.defaultValues) {
                return exprname.endsWith("$") ? "" : 0;
            }
            if (exprname != null && obj == null) {
                this.runtimeError(`I haven't set a value for ${exprname}.`);
            } else if (exprname != null) {
                this.runtimeError(`I got an invalid value for ${exprname}: ${obj}`);
            } else {
                this.runtimeError(`I got an invalid value: ${obj}`);
            }
        }
        return obj;
    }
    getDef(exprname: string) {
        var fn = this.defs[exprname];
        if (!fn) this.runtimeError(`I haven't run a DEF statement for ${exprname}.`);
        return fn;
    }
    checkNum(n:number) : number {
        if (n === Infinity) this.runtimeError(`I computed a number too big to store.`);
        if (isNaN(n)) this.runtimeError(`I computed an invalid number.`);
        return n;
    }
    checkString(s:string) : string {
        if (typeof s !== 'string')
            this.runtimeError(`I expected a string here.`);
        else if (s.length > this.opts.maxStringLength)
            this.dialectError(`create strings longer than ${this.opts.maxStringLength} characters`);
        return s;
    }
    
    add(a, b) : number|string {
        // TODO: if string-concat
        if (typeof a === 'number' && typeof b === 'number')
            return this.checkNum(a + b);
        else if (this.opts.stringConcat)
            return this.checkString(a + b);
        else
            this.dialectError(`use the "+" operator to concatenate strings`)
    }
    sub(a:number, b:number) : number {
        return this.checkNum(a - b);
    }
    mul(a:number, b:number) : number {
        return this.checkNum(a * b);
    }
    div(a:number, b:number) : number {
        if (b == 0) this.runtimeError(`I can't divide by zero.`);
        return this.checkNum(a / b);
    }
    idiv(a:number, b:number) : number {
        return this.FIX(this.INT(a) / this.INT(b));
    }
    mod(a:number, b:number) : number {
        return this.checkNum(a % b);
    }
    pow(a:number, b:number) : number {
        if (a == 0 && b < 0) this.runtimeError(`I can't raise zero to a negative power.`);
        return this.checkNum(Math.pow(a, b));
    }
    band(a:number, b:number) : number {
        return a & b;
    }
    bor(a:number, b:number) : number {
        return a | b;
    }
    bnot(a:number) : number {
        return ~a;
    }
    bxor(a:number, b:number) : number {
        return a ^ b;
    }
    bimp(a:number, b:number) : number {
        return this.bor(this.bnot(a), b);
    }
    beqv(a:number, b:number) : number {
        return this.bnot(this.bxor(a, b));
    }
    land(a:number, b:number) : number {
        return a && b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    lor(a:number, b:number) : number {
        return a || b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    lnot(a:number) : number {
        return a ? 0 : (this.opts.bitwiseLogic ? -1 : 1);
    }
    neg(a:number) : number {
        return -a;
    }
    eq(a:number, b:number) : number {
        return a == b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    ne(a:number, b:number) : number {
        return a != b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    lt(a:number, b:number) : number {
        return a < b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    gt(a:number, b:number) : number {
        return a > b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    le(a:number, b:number) : number {
        return a <= b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    ge(a:number, b:number) : number {
        return a >= b ? (this.opts.bitwiseLogic ? -1 : 1) : 0;
    }
    min(a:number, b:number) : number {
        return a < b ? a : b;
    }
    max(a:number, b:number) : number {
        return a > b ? a : b;
    }

    // FUNCTIONS (uppercase)

    ABS(arg : number) : number {
        return this.checkNum(Math.abs(arg));
    }
    ASC(arg : string) : number {
        return arg.charCodeAt(0);
    }
    ATN(arg : number) : number {
        return this.checkNum(Math.atan(arg));
    }
    CHR$(arg : number) : string {
        return String.fromCharCode(this.checkNum(arg));
    }
    CINT(arg : number) : number {
        return this.ROUND(arg);
    }
    COS(arg : number) : number {
        return this.checkNum(Math.cos(arg));
    }
    COT(arg : number) : number {
        return this.checkNum(1.0 / Math.tan(arg)); // 4th edition only
    }
    CTL(arg : number) : string {
        return this.CHR$(arg);
    }
    EXP(arg : number) : number {
        return this.checkNum(Math.exp(arg));
    }
    FIX(arg : number) : number {
        return this.checkNum(arg < 0 ? Math.ceil(arg) : Math.floor(arg));
    }
    HEX$(arg : number) : string {
        return this.ROUND(arg).toString(16);
    }
    INSTR(a, b, c) : number {
        if (c != null) {
            return this.checkString(c).indexOf(this.checkString(b), a) + 1;
        } else {
            return this.checkString(b).indexOf(this.checkString(a)) + 1;
        }
    }
    INT(arg : number) : number {
        return this.checkNum(Math.floor(arg));
    }
    LEFT$(arg : string, count : number) : string {
        return arg.substr(0, count);
    }
    LEN(arg : string) : number {
        return this.checkString(arg).length;
    }
    LIN(arg : number) : string {
        return this.STRING$(arg, '\n');
    }
    LOG(arg : number) : number {
        if (arg == 0) this.runtimeError(`I can't take the logarithm of zero (${arg}).`)
        if (arg < 0) this.runtimeError(`I can't take the logarithm of a negative number (${arg}).`)
        return this.checkNum(Math.log(arg));
    }
    MID$(arg : string, start : number, count : number) : string {
        if (start < 1) this.runtimeError(`I can't compute MID$ if the starting index is less than 1.`)
        if (count == 0) count = arg.length;
        return arg.substr(start-1, count);
    }
    OCT$(arg : number) : string {
        return this.ROUND(arg).toString(8);
    }
    POS(arg : number) : number { // arg ignored
        return this.column + 1;
    }
    RIGHT$(arg : string, count : number) : string {
        return arg.substr(arg.length - count, count);
    }
    RND(arg : number) : number {
        // TODO: X<0 restart w/ seed, X=0 repeats
        return this.rng.next();
    }
    ROUND(arg : number) : number {
        return this.checkNum(Math.round(arg));
    }
    SGN(arg : number) : number {
        return (arg < 0) ? -1 : (arg > 0) ? 1 : 0;
    }
    SIN(arg : number) : number {
        return this.checkNum(Math.sin(arg));
    }
    SPACE$(arg : number) : string {
        arg = this.ROUND(arg);
        return (arg > 0) ? ' '.repeat(arg) : '';
    }
    SPC(arg : number) : string {
        return this.SPACE$(arg);
    }
    SQR(arg : number) : number {
        if (arg < 0) this.runtimeError(`I can't take the square root of a negative number (${arg}).`)
        return this.checkNum(Math.sqrt(arg));
    }
    STR$(arg : number) : string {
        return this.valueToString(this.checkNum(arg));
    }
    STRING$(len : number, chr : number|string) : string {
        len = this.ROUND(len);
        if (len <= 0) return '';
        if (typeof chr === 'string') return chr.substr(0,1).repeat(len);
        else return String.fromCharCode(chr).repeat(len);
    }
    TAB(arg : number) : string {
        if (arg < 1) { arg = 1; } // TODO: SYSTEM MESSAGE IDENTIFYING THE EXCEPTION
        var spaces = this.ROUND(arg) - 1 - this.column;
        return (spaces > 0) ? ' '.repeat(spaces) : '';
    }
    TAN(arg : number) : number {
        return this.checkNum(Math.tan(arg));
    }
    TIM(arg : number) { // only HP BASIC?
        var d = new Date();
        switch (this.ROUND(arg)) {
            case 0: return d.getMinutes();
            case 1: return d.getHours();
            case 2:
                var dayCount = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
                var mn = d.getMonth();
                var dn = d.getDate();
                var dayOfYear = dayCount[mn] + dn;
                var isLeapYear = (d.getFullYear() & 3) == 0; // TODO: wrong
                if(mn > 1 && isLeapYear) dayOfYear++;
                return dayOfYear;
            case 3: return d.getFullYear() % 100; // Y@K!
            case 4: return d.getSeconds();
            default: return 0;
        }
    }
    TIMER() : number {
        return Date.now() / 1000;
    }
    UPS$(arg : string) : string {
        return this.checkString(arg).toUpperCase();
    }
    VAL(arg : string) : number {
        var n = parseFloat(this.checkString(arg));
        return isNaN(n) ? 0 : n; // TODO? altair works this way
    }
}
