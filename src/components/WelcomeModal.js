import React, { Component } from 'react'
import ReactDOM from 'react-dom';
import Modal from 'react-modal';

Modal.setAppElement('#root');

const customStyles = {
  content : {
    top                   : '50%',
    // left                  : '50%',
    // right                 : 'auto',
    bottom                : 'auto',
    // marginRight           : '-50%',
    transform             : 'translate(0%, -50%)',
    borderRadius: '20px'
  },
  overlay: {
    zIndex: 1000,
    backgroundColor: 'rgba(255, 255, 255, 0.75)'
  }
};

export default class WelcomeModal extends Component {
  constructor(props){
    super(props)
    this.state = {isopen: true}
  }
  render(){
    return (
      <Modal
        isOpen={this.state.isopen}
        onRequestClose={()=>this.setState({isopen:false})}
        style={customStyles}
        contentLabel="Example Modal"
      >
        <h2 style={{textAlign: 'center'}}>E se fosse lá em casa?</h2>
        <p style={{textAlign: 'justify'}}>
          Placeholder
        </p>
        <p style={{textAlign: 'right', fontSize:'small', marginTop: '30px'}}>Encontrou um Bug? Nos ajude reportando-o em placeholder@gmail.com</p>
      </Modal>
    )
  }
}
